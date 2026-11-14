import type { FastifyInstance } from 'fastify';
import { customAlphabet } from 'nanoid';
import { z } from 'zod';
import {
  AlipayConfigError,
  precreateFailureMessage,
  qrCodeFromResult,
  tradePrecreate,
  tradeQuery,
} from '../alipay.js';
import {
  EpayConfigError,
  buyerReturnUrl,
  epayCreate,
  epayCreateFailureMessage,
  epayQuery,
  qrOrPayContent,
  requestOrigin,
} from '../epay.js';
import { config } from '../config.js';
import {
  INSECURE_HTTP_PAY_HINT,
  notifyUrlFromRequest,
  requestAccessFromRequest,
} from '../security.js';
import {
  epayConfigured,
  getOrderByOutTradeNo,
  loadEpaySettings,
  loadPaymentMethodLabels,
  settingsConfigured,
  usdtConfigured,
  updateOrder,
} from '../db.js';
import {
  createReservedCheckoutOrder,
  getPublicOrderView,
  isPaidStatus,
  releaseReservationsForOrder,
  StockError,
} from '../cardKeys.js';
import { applyVerifiedTrade, allowPublicTradeQuery } from '../paymentSync.js';
import {
  epayTypeFromMethod,
  isEpayPaymentChannel,
  isPaymentMethodId,
  isUsdtPaymentChannel,
  listAvailablePaymentMethods,
  resolvePaymentLabel,
  type PaymentMethodId,
} from '../paymentMethods.js';
import {
  assignUsdtPayment,
  listEnabledUsdtPaymentMethods,
  scanUsdtDeposits,
  UsdtConfigError,
} from '../usdt.js';

const nano = customAlphabet('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ', 12);

function genOutTradeNo(): string {
  const d = new Date();
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  return `JM${stamp}${nano()}`;
}

function availableMethods() {
  return listAvailablePaymentMethods({
    alipayConfigured: settingsConfigured(),
    epayConfigured: epayConfigured(),
    epayChannels: loadEpaySettings()?.channels ?? [],
    usdtConfigured: usdtConfigured(),
    usdtChannels: listEnabledUsdtPaymentMethods(),
    labels: loadPaymentMethodLabels(),
  });
}

async function maybeRefreshFromProvider(outTradeNo: string): Promise<void> {
  const order = getOrderByOutTradeNo(outTradeNo);
  if (!order || isPaidStatus(order.status)) return;
  if (order.status === 'TRADE_CLOSED' || order.status === 'FAILED') return;
  if (!allowPublicTradeQuery(outTradeNo)) return;
  try {
    if (isUsdtPaymentChannel(order.payment_channel)) {
      await scanUsdtDeposits();
      return;
    }
    if (isEpayPaymentChannel(order.payment_channel)) {
      const result = await epayQuery(outTradeNo);
      if (!result.ok || !result.tradeStatus) return;
      applyVerifiedTrade({
        outTradeNo,
        tradeStatus: result.tradeStatus,
        tradeNo: result.tradeNo,
        identity: {
          totalAmount: result.money,
          pid: result.pid,
        },
        source: 'query',
        provider: 'epay',
      });
      return;
    }
    const result = await tradeQuery(outTradeNo);
    if (!result.ok || !result.tradeStatus) return;
    applyVerifiedTrade({
      outTradeNo,
      tradeStatus: result.tradeStatus,
      tradeNo: result.tradeNo,
      buyerLogonId: result.buyerLogonId,
      identity: {
        totalAmount: result.totalAmount,
        appId: result.appId,
        sellerId: result.sellerId,
      },
      source: 'query',
      provider: 'alipay',
    });
  } catch {
    // 配置缺失或网络错误时，仍返回本地公开视图
  }
}

export async function storeRoutes(app: FastifyInstance): Promise<void> {
  /** 前台公开：当前可用的买家支付方式，不返回密钥、商户号或网关。 */
  app.get('/api/store/payment', async (req) => {
    const access = requestAccessFromRequest(req);
    const methods = availableMethods();
    return {
      ok: true,
      alipayConfigured: settingsConfigured(),
      epayConfigured: epayConfigured(),
      usdtConfigured: usdtConfigured(),
      methods,
      notifyEnabled: Boolean(access.notifyUrl || access.epayNotifyUrl || access.usdtNotifyUrl),
      insecureHttp: access.insecureHttp,
      hint: access.insecureHttp ? INSECURE_HTTP_PAY_HINT : undefined,
    };
  });

  /**
   * 购物车结账：先写本地订单并预占卡密，再按所选方式向支付宝或易支付下单。
   */
  app.post(
    '/api/checkout',
    {
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      const parsed = z
        .object({
          items: z
            .array(
              z.object({
                productId: z.number().int().positive(),
                quantity: z.number().int().min(1).max(99),
              }),
            )
            .min(1)
            .max(50),
          buyerNote: z.string().max(200).optional(),
          paymentMethod: z.string().max(32).optional(),
        })
        .safeParse(req.body);

      if (!parsed.success) {
        return reply.code(400).send({
          ok: false,
          error: parsed.error.issues.map((i) => i.message).join('; '),
        });
      }

      const methods = availableMethods();
      if (!methods.length) {
        return reply.code(400).send({
          ok: false,
          error: '支付暂不可用，请稍后再试或联系商家',
        });
      }

      let methodId: PaymentMethodId;
      const requested = (parsed.data.paymentMethod || '').trim();
      if (requested) {
        if (!isPaymentMethodId(requested) || !methods.some((m) => m.id === requested)) {
          return reply.code(400).send({
            ok: false,
            error: '该支付方式暂不可用，请选择其他方式或联系商家',
          });
        }
        methodId = requested;
      } else if (methods.length === 1) {
        methodId = methods[0].id;
      } else {
        return reply.code(400).send({ ok: false, error: '请选择支付方式' });
      }

      const outTradeNo = genOutTradeNo();
      let orderId: number | null = null;
      const access = requestAccessFromRequest(req);
      const payLabel = resolvePaymentLabel(methodId, {
        labels: loadPaymentMethodLabels(),
      });

      try {
        const reserved = createReservedCheckoutOrder({
          outTradeNo,
          buyerNote: parsed.data.buyerNote?.trim() || null,
          paymentChannel: methodId,
          paymentLabel: payLabel,
          items: parsed.data.items,
        });
        orderId = reserved.order.id;
        const lines = reserved.lines;
        const subject = reserved.subject;

        if (isUsdtPaymentChannel(methodId)) {
          const payment = assignUsdtPayment(outTradeNo);
          const order = getOrderByOutTradeNo(outTradeNo)!;
          return {
            ok: true,
            order: {
              outTradeNo: order.out_trade_no,
              subject: order.subject,
              totalAmount: order.total_amount,
              status: order.status,
              qrCode: payment.qrContent,
              payMethod: payLabel,
              paymentMethod: methodId,
              usdt: {
                address: payment.address,
                amount: payment.amount,
                network: payment.network,
                expireAt: payment.expireAt,
                qrContent: payment.qrContent,
              },
              items: lines.map((l) => ({
                productId: l.productId,
                name: l.productName,
                coverUrl: l.coverUrl,
                unitPrice: l.unitPrice,
                quantity: l.quantity,
              })),
            },
          };
        }

        const epayType = epayTypeFromMethod(methodId);
        if (epayType) {
          const origin = requestOrigin({
            protocol: req.protocol,
            hostname: req.hostname,
            headers: req.headers as Record<string, unknown>,
            fallbackOrigin: config.webOrigin,
          });
          const result = await epayCreate({
            type: epayType,
            outTradeNo,
            name: subject,
            money: reserved.totalAmount,
            clientIp: req.ip,
            device: 'pc',
            notifyUrl: access.epayNotifyUrl,
            returnUrl: buyerReturnUrl(origin, outTradeNo),
            audience: 'buyer',
          });
          const qrCode = result.ok ? qrOrPayContent(result) : undefined;
          if (!result.ok || !qrCode) {
            updateOrder(outTradeNo, { status: 'FAILED' });
            releaseReservationsForOrder(orderId);
            return reply.code(400).send({
              ok: false,
              error: result.ok
                ? '未能生成收款码，请稍后重试或联系商家'
                : epayCreateFailureMessage(result, {
                    insecureHttp: access.insecureHttp,
                  }),
            });
          }
          updateOrder(outTradeNo, {
            qr_code: qrCode,
            trade_no: result.tradeNo,
          });
          const order = getOrderByOutTradeNo(outTradeNo)!;
          return {
            ok: true,
            order: {
              outTradeNo: order.out_trade_no,
              subject: order.subject,
              totalAmount: order.total_amount,
              status: order.status,
              qrCode: order.qr_code,
              payUrl: result.payUrl || undefined,
              payScheme: result.urlScheme || undefined,
              payMethod: payLabel,
              paymentMethod: methodId,
              items: lines.map((l) => ({
                productId: l.productId,
                name: l.productName,
                coverUrl: l.coverUrl,
                unitPrice: l.unitPrice,
                quantity: l.quantity,
              })),
            },
          };
        }

        const result = await tradePrecreate({
          outTradeNo,
          totalAmount: reserved.totalAmount,
          subject,
          body: lines.map((l) => `${l.productName}x${l.quantity}`).join(', '),
          notifyUrl: notifyUrlFromRequest(req),
          audience: 'buyer',
        });

        const qrCode = result.ok ? qrCodeFromResult(result) : undefined;
        if (!result.ok || !qrCode) {
          updateOrder(outTradeNo, { status: 'FAILED' });
          releaseReservationsForOrder(orderId);
          return reply.code(400).send({
            ok: false,
            error: result.ok
              ? '未能生成收款码，请稍后重试或联系商家'
              : precreateFailureMessage(result, {
                  insecureHttp: access.insecureHttp,
                }),
            code: result.code,
            subCode: result.subCode,
          });
        }

        updateOrder(outTradeNo, { qr_code: qrCode });
        const order = getOrderByOutTradeNo(outTradeNo)!;

        return {
          ok: true,
          order: {
            outTradeNo: order.out_trade_no,
            subject: order.subject,
            totalAmount: order.total_amount,
            status: order.status,
            qrCode: order.qr_code,
            payMethod: payLabel,
            items: lines.map((l) => ({
              productId: l.productId,
              name: l.productName,
              coverUrl: l.coverUrl,
              unitPrice: l.unitPrice,
              quantity: l.quantity,
            })),
          },
        };
      } catch (err) {
        if (orderId != null) {
          try {
            updateOrder(outTradeNo, { status: 'FAILED' });
            releaseReservationsForOrder(orderId);
          } catch {
            /* ignore */
          }
        }
        if (err instanceof StockError) {
          return reply.code(400).send({ ok: false, error: err.message });
        }
        if (err instanceof AlipayConfigError || err instanceof EpayConfigError || err instanceof UsdtConfigError) {
          return reply.code(400).send({ ok: false, error: err.message });
        }
        throw err;
      }
    },
  );

  /** 买家查单：仅返回公开视图；必要时在服务端限频向支付渠道同步。 */
  app.get(
    '/api/orders/query/:outTradeNo',
    {
      config: { rateLimit: { max: 40, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      const { outTradeNo } = req.params as { outTradeNo: string };
      const no = outTradeNo.trim();
      if (!no) {
        return reply.code(400).send({ ok: false, error: '缺少商户单号' });
      }
      await maybeRefreshFromProvider(no);
      const order = getPublicOrderView(no);
      if (!order) {
        return reply.code(404).send({ ok: false, error: '订单不存在' });
      }
      return { ok: true, order };
    },
  );
}
