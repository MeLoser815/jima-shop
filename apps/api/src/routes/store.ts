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
  INSECURE_HTTP_PAY_HINT,
  notifyUrlFromRequest,
  requestAccessFromRequest,
} from '../security.js';
import { getOrderByOutTradeNo, settingsConfigured, updateOrder } from '../db.js';
import {
  createReservedCheckoutOrder,
  getPublicOrderView,
  isPaidStatus,
  releaseReservationsForOrder,
  StockError,
} from '../cardKeys.js';
import { applyVerifiedTrade, allowAlipayQuery } from '../paymentSync.js';

const nano = customAlphabet('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ', 12);

function genOutTradeNo(): string {
  const d = new Date();
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  return `JM${stamp}${nano()}`;
}

async function maybeRefreshFromAlipay(outTradeNo: string): Promise<void> {
  const order = getOrderByOutTradeNo(outTradeNo);
  if (!order || isPaidStatus(order.status)) return;
  if (order.status === 'TRADE_CLOSED' || order.status === 'FAILED') return;
  if (!allowAlipayQuery(outTradeNo)) return;
  try {
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
    });
  } catch {
    // 配置缺失或网络错误时，仍返回本地公开视图
  }
}

export async function storeRoutes(app: FastifyInstance): Promise<void> {
  /** 前台公开：是否已配置支付宝，不返回任何密钥。 */
  app.get('/api/store/payment', async (req) => {
    const access = requestAccessFromRequest(req);
    return {
      ok: true,
      alipayConfigured: settingsConfigured(),
      notifyEnabled: Boolean(access.notifyUrl),
      insecureHttp: access.insecureHttp,
      hint: access.insecureHttp ? INSECURE_HTTP_PAY_HINT : undefined,
    };
  });

  /**
   * 购物车结账：先写本地订单并预占卡密，再向支付宝预下单。
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
        })
        .safeParse(req.body);

      if (!parsed.success) {
        return reply.code(400).send({
          ok: false,
          error: parsed.error.issues.map((i) => i.message).join('; '),
        });
      }

      const outTradeNo = genOutTradeNo();
      let orderId: number | null = null;

      try {
        const reserved = createReservedCheckoutOrder({
          outTradeNo,
          buyerNote: parsed.data.buyerNote?.trim() || null,
          items: parsed.data.items,
        });
        orderId = reserved.order.id;
        const lines = reserved.lines;
        const subject = reserved.subject;

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
                  insecureHttp: requestAccessFromRequest(req).insecureHttp,
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
        if (err instanceof AlipayConfigError) {
          return reply.code(400).send({ ok: false, error: err.message });
        }
        throw err;
      }
    },
  );

  /** 买家查单：仅返回公开视图；必要时在服务端限频向支付宝同步。 */
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
      await maybeRefreshFromAlipay(no);
      const order = getPublicOrderView(no);
      if (!order) {
        return reply.code(404).send({ ok: false, error: '订单不存在' });
      }
      return { ok: true, order };
    },
  );
}
