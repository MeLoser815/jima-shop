import {
  getOrderByOutTradeNo,
  loadAlipaySettings,
  loadEpaySettings,
  updateOrder,
  type OrderRow,
} from './db.js';
import {
  isPaidStatus,
  markOrderPaidAndDeliverKeys,
  releaseReservationsForOrder,
} from './cardKeys.js';
import { isEpayPaymentChannel } from './paymentMethods.js';
import {
  matchNotifyToOrder,
  matchQueryToOrder,
  matchEpayNotifyToOrder,
  matchEpayQueryToOrder,
  epayIdentityFromNotify,
  type PaymentIdentity,
  type EpayPaymentIdentity,
} from './paymentMatch.js';
import {
  isEpayNotifyPaid,
  epayNotifyTradeStatus,
  verifyEpaySign,
} from './epay.js';

export type ApplyTradeResult =
  | { ok: true; order: OrderRow }
  | { ok: false; reason: string; orderMissing?: boolean };

function configuredAlipayIdentity(): { appId: string; sellerId?: string } | null {
  const s = loadAlipaySettings();
  if (!s) return null;
  return { appId: s.appId, sellerId: s.sellerId || undefined };
}

function configuredEpayIdentity(): { pid: string } | null {
  const s = loadEpaySettings();
  if (!s || !s.enabled || !s.pid || !s.key) return null;
  return { pid: s.pid };
}

export function applyVerifiedTrade(input: {
  outTradeNo: string;
  tradeStatus?: string;
  tradeNo?: string;
  buyerLogonId?: string;
  identity: PaymentIdentity | EpayPaymentIdentity;
  rawNotify?: string;
  source: 'notify' | 'query';
  provider?: 'alipay' | 'epay';
}): ApplyTradeResult {
  const order = getOrderByOutTradeNo(input.outTradeNo);
  if (!order) {
    return { ok: false, reason: 'order_missing', orderMissing: true };
  }

  const provider =
    input.provider ??
    (isEpayPaymentChannel(order.payment_channel) ? 'epay' : 'alipay');

  const status = input.tradeStatus || '';
  const paid = isPaidStatus(status);

  // 已支付订单不可被后续 TRADE_CLOSED / FAILED 查单或通知降级，也不释放已售卡密。
  if (isPaidStatus(order.status)) {
    if (!paid) {
      const updated = getOrderByOutTradeNo(input.outTradeNo);
      return { ok: true, order: updated! };
    }
  }

  if (paid) {
    if (provider === 'epay') {
      const configured = configuredEpayIdentity();
      if (!configured) {
        return { ok: false, reason: 'epay_unconfigured' };
      }
      const identity = input.identity as EpayPaymentIdentity;
      const match =
        input.source === 'notify'
          ? matchEpayNotifyToOrder(order, identity, configured)
          : matchEpayQueryToOrder(order, identity, configured);
      if (!match.ok) {
        return { ok: false, reason: match.reason };
      }
    } else {
      const configured = configuredAlipayIdentity();
      if (!configured) {
        return { ok: false, reason: 'alipay_unconfigured' };
      }
      const identity = input.identity as PaymentIdentity;
      const match =
        input.source === 'notify'
          ? matchNotifyToOrder(order, identity, configured)
          : matchQueryToOrder(order, identity, configured);
      if (!match.ok) {
        return { ok: false, reason: match.reason };
      }
    }
    markOrderPaidAndDeliverKeys(input.outTradeNo, {
      status,
      trade_no: input.tradeNo,
      buyer_logon_id: input.buyerLogonId,
      raw_notify: input.rawNotify,
    });
  } else if (status) {
    updateOrder(input.outTradeNo, {
      status,
      trade_no: input.tradeNo,
      buyer_logon_id: input.buyerLogonId,
      raw_notify: input.rawNotify,
    });
    if (status === 'TRADE_CLOSED' || status === 'FAILED') {
      releaseReservationsForOrder(order.id);
    }
  }

  const updated = getOrderByOutTradeNo(input.outTradeNo);
  return { ok: true, order: updated! };
}

const lastTradeQueryAt = new Map<string, number>();
export const PUBLIC_TRADE_QUERY_INTERVAL_MS = 8_000;

export function allowAlipayQuery(
  outTradeNo: string,
  intervalMs = PUBLIC_TRADE_QUERY_INTERVAL_MS,
  now = Date.now(),
): boolean {
  return allowPublicTradeQuery(outTradeNo, intervalMs, now);
}

export function allowPublicTradeQuery(
  outTradeNo: string,
  intervalMs = PUBLIC_TRADE_QUERY_INTERVAL_MS,
  now = Date.now(),
): boolean {
  const prev = lastTradeQueryAt.get(outTradeNo) ?? 0;
  if (now - prev < intervalMs) return false;
  lastTradeQueryAt.set(outTradeNo, now);
  return true;
}

/** 仅用于测试：清空查单节流状态。 */
export function resetAlipayQueryThrottleForTests(): void {
  lastTradeQueryAt.clear();
}

export type EpayNotifyHandleResult = {
  body: 'success' | 'fail';
  reason: string;
};

/**
 * 处理易支付异步通知。验签失败或金额/商户号不一致回 fail；
 * 未支付（含仅有 status=0 / TRADE_CLOSED）回 success 但不发卡。
 */
export function processEpayNotify(
  params: Record<string, string>,
): EpayNotifyHandleResult {
  const settings = loadEpaySettings();
  if (!settings?.key) return { body: 'fail', reason: 'unconfigured' };
  if (!verifyEpaySign(params, settings.key)) {
    return { body: 'fail', reason: 'bad_sign' };
  }
  const outTradeNo = String(params.out_trade_no || '').trim();
  if (!outTradeNo) return { body: 'fail', reason: 'missing_out_trade_no' };
  if (!isEpayNotifyPaid(params)) {
    return { body: 'success', reason: 'not_paid' };
  }
  const tradeStatus = epayNotifyTradeStatus(params) || 'TRADE_SUCCESS';
  const applied = applyVerifiedTrade({
    outTradeNo,
    tradeStatus,
    tradeNo: params.trade_no,
    identity: epayIdentityFromNotify(params),
    rawNotify: JSON.stringify(params),
    source: 'notify',
    provider: 'epay',
  });
  if (!applied.ok) return { body: 'fail', reason: applied.reason };
  return { body: 'success', reason: 'applied' };
}
