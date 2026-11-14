import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { customAlphabet } from 'nanoid';
import { z } from 'zod';
import {
  AlipayConfigError,
  checkNotifySign,
  precreateFailureMessage,
  qrCodeFromResult,
  tradePay,
  tradePrecreate,
  tradeQuery,
} from '../alipay.js';
import {
  EpayConfigError,
  collectEpayParams,
  epayQuery,
} from '../epay.js';
import { processUsdtNotify, scanUsdtDeposits, UsdtConfigError } from '../usdt.js';
import { notifyUrlFromRequest } from '../security.js';
import {
  createOrder,
  getOrderByOutTradeNo,
  updateOrder,
} from '../db.js';
import { getPublicOrderView } from '../cardKeys.js';
import { requireAdmin } from '../middleware/auth.js';
import {
  paymentIdentityFromNotify,
} from '../paymentMatch.js';
import { applyVerifiedTrade, processEpayNotify } from '../paymentSync.js';
import { isEpayPaymentChannel, isUsdtPaymentChannel } from '../paymentMethods.js';

const nano = customAlphabet('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ', 16);

function genOutTradeNo(): string {
  const d = new Date();
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  return `JIMA${stamp}${nano()}`;
}

const amountSchema = z
  .string()
  .regex(/^\d+(\.\d{1,2})?$/, '金额格式错误')
  .refine((v) => Number(v) >= 0.01, '金额至少 0.01');

export async function paymentRoutes(app: FastifyInstance): Promise<void> {
  /** 当面付预下单：生成收款二维码（仅管理员） */
  app.post(
    '/api/payment/precreate',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const parsed = z
        .object({
          amount: amountSchema,
          subject: z.string().min(1).max(256),
          body: z.string().max(128).optional(),
          outTradeNo: z.string().min(1).max(64).optional(),
        })
        .safeParse(req.body);

      if (!parsed.success) {
        return reply.code(400).send({
          ok: false,
          error: parsed.error.issues.map((i) => i.message).join('; '),
        });
      }

      const outTradeNo = parsed.data.outTradeNo || genOutTradeNo();
      try {
        const order = createOrder({
          outTradeNo,
          subject: parsed.data.subject,
          totalAmount: parsed.data.amount,
          status: 'WAIT_BUYER_PAY',
          paymentChannel: 'alipay_f2f',
        });

        const result = await tradePrecreate({
          outTradeNo,
          totalAmount: parsed.data.amount,
          subject: parsed.data.subject,
          body: parsed.data.body,
          notifyUrl: notifyUrlFromRequest(req),
        });

        const qrCode = result.ok ? qrCodeFromResult(result) : undefined;
        if (!result.ok || !qrCode) {
          updateOrder(outTradeNo, { status: 'FAILED' });
          return reply.code(400).send({
            ok: false,
            error: result.ok
              ? '未能生成收款码，请稍后重试'
              : precreateFailureMessage(result),
            code: result.code,
            subCode: result.subCode,
          });
        }

        updateOrder(outTradeNo, { qr_code: qrCode });
        const updated = getOrderByOutTradeNo(outTradeNo) ?? order;

        return {
          ok: true,
          order: {
            outTradeNo: updated.out_trade_no,
            subject: updated.subject,
            totalAmount: updated.total_amount,
            status: updated.status,
            qrCode: updated.qr_code,
          },
        };
      } catch (err) {
        updateOrder(outTradeNo, { status: 'FAILED' });
        if (err instanceof AlipayConfigError) {
          return reply.code(400).send({ ok: false, error: err.message });
        }
        throw err;
      }
    },
  );

  /** 当面付付款码（仅管理员） */
  app.post(
    '/api/payment/pay',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const parsed = z
        .object({
          amount: amountSchema,
          subject: z.string().min(1).max(256),
          authCode: z.string().min(8).max(64),
          outTradeNo: z.string().min(1).max(64).optional(),
        })
        .safeParse(req.body);

      if (!parsed.success) {
        return reply.code(400).send({
          ok: false,
          error: parsed.error.issues.map((i) => i.message).join('; '),
        });
      }

      const outTradeNo = parsed.data.outTradeNo || genOutTradeNo();
      try {
        createOrder({
          outTradeNo,
          subject: parsed.data.subject,
          totalAmount: parsed.data.amount,
          status: 'PAYING',
          paymentChannel: 'alipay_f2f',
        });

        const result = await tradePay({
          outTradeNo,
          totalAmount: parsed.data.amount,
          subject: parsed.data.subject,
          authCode: parsed.data.authCode,
          notifyUrl: notifyUrlFromRequest(req),
        });

        if (!result.ok) {
          updateOrder(outTradeNo, { status: 'FAILED' });
          return reply.code(400).send({
            ok: false,
            error: result.subMsg || result.msg || '付款码支付失败',
            code: result.code,
            subCode: result.subCode,
          });
        }

        const paid =
          result.tradeStatus === 'TRADE_SUCCESS' ||
          result.tradeStatus === 'TRADE_FINISHED';
        if (paid) {
          const applied = applyVerifiedTrade({
            outTradeNo,
            tradeStatus: result.tradeStatus,
            tradeNo: result.tradeNo,
            buyerLogonId: result.buyerLogonId,
            identity: {
              totalAmount: result.totalAmount || parsed.data.amount,
              appId: result.appId,
              sellerId: result.sellerId,
            },
            source: 'query',
          });
          if (!applied.ok) {
            app.log.warn(
              { outTradeNo, reason: applied.reason },
              '付款码支付结果与本地订单不一致，未发卡',
            );
            return reply.code(400).send({
              ok: false,
              error: '支付结果核验失败，请稍后在订单中核对',
            });
          }
        } else if (result.tradeStatus) {
          updateOrder(outTradeNo, {
            status: result.tradeStatus,
            trade_no: result.tradeNo,
            buyer_logon_id: result.buyerLogonId,
          });
        }

        const local = getOrderByOutTradeNo(outTradeNo)!;
        return {
          ok: true,
          order: {
            out_trade_no: local.out_trade_no,
            total_amount: local.total_amount,
            subject: local.subject,
            status: local.status,
            qr_code: local.qr_code,
          },
          alipay: {
            tradeNo: result.tradeNo,
            tradeStatus: result.tradeStatus,
          },
        };
      } catch (err) {
        if (err instanceof AlipayConfigError) {
          return reply.code(400).send({ ok: false, error: err.message });
        }
        throw err;
      }
    },
  );

  /** 管理员查看本地订单（不含 raw_notify） */
  app.get(
    '/api/payment/orders/:outTradeNo',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const { outTradeNo } = req.params as { outTradeNo: string };
      const view = getPublicOrderView(outTradeNo);
      if (!view) {
        return reply.code(404).send({ ok: false, error: '订单不存在' });
      }
      const order = getOrderByOutTradeNo(outTradeNo)!;
      return {
        ok: true,
        order: {
          ...view,
          updatedAt: order.updated_at,
        },
      };
    },
  );

  /** 管理员主动向支付宝查单并同步本地状态 */
  app.post(
    '/api/payment/query',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const parsed = z
        .object({ outTradeNo: z.string().min(1) })
        .safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ ok: false, error: '缺少 outTradeNo' });
      }
      try {
        const local = getOrderByOutTradeNo(parsed.data.outTradeNo);
        if (isUsdtPaymentChannel(local?.payment_channel)) {
          await scanUsdtDeposits();
          const order = getPublicOrderView(parsed.data.outTradeNo);
          return {
            ok: true,
            tradeStatus: order?.status,
            tradeNo: order?.tradeNo,
            order,
          };
        }
        const useEpay = isEpayPaymentChannel(local?.payment_channel);
        if (useEpay) {
          const result = await epayQuery(parsed.data.outTradeNo);
          if (!result.ok) {
            return reply.code(400).send({
              ok: false,
              error: result.msg || '查单失败',
            });
          }
          const applied = applyVerifiedTrade({
            outTradeNo: parsed.data.outTradeNo,
            tradeStatus: result.tradeStatus,
            tradeNo: result.tradeNo,
            identity: {
              totalAmount: result.money,
              pid: result.pid,
            },
            source: 'query',
            provider: 'epay',
          });
          if (!applied.ok) {
            app.log.warn(
              {
                outTradeNo: parsed.data.outTradeNo,
                tradeStatus: result.tradeStatus,
                reason: applied.reason,
              },
              '查单结果与本地订单不一致',
            );
            return reply.code(400).send({
              ok: false,
              error: '查单结果与本地订单不一致，未更新发卡状态',
            });
          }
          return {
            ok: true,
            tradeStatus: result.tradeStatus,
            tradeNo: result.tradeNo,
            order: getPublicOrderView(parsed.data.outTradeNo),
          };
        }

        const result = await tradeQuery(parsed.data.outTradeNo);
        if (!result.ok) {
          return reply.code(400).send({
            ok: false,
            error: result.subMsg || result.msg || '查单失败',
            code: result.code,
            subCode: result.subCode,
          });
        }

        const applied = applyVerifiedTrade({
          outTradeNo: parsed.data.outTradeNo,
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
        if (!applied.ok) {
          app.log.warn(
            {
              outTradeNo: parsed.data.outTradeNo,
              tradeStatus: result.tradeStatus,
              reason: applied.reason,
            },
            '查单结果与本地订单不一致',
          );
          return reply.code(400).send({
            ok: false,
            error: '查单结果与本地订单不一致，未更新发卡状态',
          });
        }

        return {
          ok: true,
          tradeStatus: result.tradeStatus,
          tradeNo: result.tradeNo,
          order: getPublicOrderView(parsed.data.outTradeNo),
        };
      } catch (err) {
        if (err instanceof AlipayConfigError || err instanceof EpayConfigError || err instanceof UsdtConfigError) {
          return reply.code(400).send({ ok: false, error: err.message });
        }
        throw err;
      }
    },
  );

  /**
   * 支付宝异步通知（application/x-www-form-urlencoded）
   * 验签通过且与本地订单核对后更新，必须返回纯文本 success / fail
   */
  app.post('/api/payment/notify', async (req, reply) => {
    const body = req.body as Record<string, string>;
    const params: Record<string, string> = {};
    for (const [k, v] of Object.entries(body ?? {})) {
      if (v !== undefined && v !== null) params[k] = String(v);
    }

    const outTradeNo = params.out_trade_no;
    const tradeStatus = params.trade_status;

    try {
      const signed = checkNotifySign(params);
      if (!signed) {
        app.log.warn({ outTradeNo, tradeStatus }, '支付宝通知验签失败');
        return reply.code(400).type('text/plain').send('fail');
      }
    } catch (err) {
      app.log.error(
        { err, outTradeNo, tradeStatus },
        '验签异常',
      );
      return reply.code(400).type('text/plain').send('fail');
    }

    if (!outTradeNo) {
      app.log.warn({ tradeStatus }, '支付宝通知缺少 out_trade_no');
      return reply.code(400).type('text/plain').send('fail');
    }

    const applied = applyVerifiedTrade({
      outTradeNo,
      tradeStatus,
      tradeNo: params.trade_no,
      buyerLogonId: params.buyer_logon_id,
      identity: paymentIdentityFromNotify(params),
      rawNotify: JSON.stringify(params),
      source: 'notify',
    });

    if (!applied.ok) {
      app.log.warn(
        { outTradeNo, tradeStatus, reason: applied.reason },
        applied.orderMissing
          ? '支付宝通知对应订单不存在'
          : '支付宝通知与本地订单核对失败',
      );
      return reply.type('text/plain').send('fail');
    }

    app.log.info({ outTradeNo, tradeStatus, outcome: 'applied' }, '支付宝通知已处理');
    return reply.type('text/plain').send('success');
  });

  /**
   * 易支付异步通知（GET / POST）。
   * 验签通过且已支付后履约发卡；未支付回 success 但不发卡。必须返回纯文本 success / fail。
   */
  const handleEpayNotify = async (req: FastifyRequest, reply: FastifyReply) => {
    const params = collectEpayParams({
      ...(req.query as Record<string, unknown> | undefined),
      ...(req.body as Record<string, unknown> | undefined),
    });
    const outTradeNo = params.out_trade_no;
    const result = processEpayNotify(params);
    if (result.body === 'fail') {
      app.log.warn(
        { outTradeNo, reason: result.reason, tradeStatus: params.trade_status, status: params.status },
        result.reason === 'bad_sign'
          ? '易支付通知验签失败'
          : result.reason === 'unconfigured'
            ? '易支付通知时尚未配置密钥'
            : '易支付通知处理失败',
      );
      return reply.code(400).type('text/plain').send('fail');
    }
    if (result.reason === 'applied') {
      app.log.info(
        { outTradeNo, tradeStatus: params.trade_status, status: params.status, outcome: 'applied' },
        '易支付通知已处理',
      );
    }
    return reply.type('text/plain').send('success');
  };

  app.get('/api/payment/epay/notify', handleEpayNotify);
  app.post('/api/payment/epay/notify', handleEpayNotify);

  /**
   * 可选 USDT 补通知。必须校验交易哈希（并尽量链上核对）或服务端签名，不能无校验发卡。
   */
  const handleUsdtNotify = async (req: FastifyRequest, reply: FastifyReply) => {
    const params = {
      ...((req.query as Record<string, unknown> | undefined) ?? {}),
      ...((req.body as Record<string, unknown> | undefined) ?? {}),
    };
    const result = await processUsdtNotify(params);
    if (!result.ok) {
      app.log.warn({ reason: result.reason, tx: params.tx_hash }, 'USDT 通知未履约');
      return reply.code(400).send({ ok: false, error: '通知校验失败' });
    }
    return reply.send({ ok: true });
  };

  app.get('/api/payment/usdt/notify', handleUsdtNotify);
  app.post('/api/payment/usdt/notify', handleUsdtNotify);
}
