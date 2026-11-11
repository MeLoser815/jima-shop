import {
  getOrderByOutTradeNo,
  loadAlipaySettings,
  updateOrder,
  type OrderRow,
} from './db.js';
import {
  isPaidStatus,
  markOrderPaidAndDeliverKeys,
  releaseReservationsForOrder,
} from './cardKeys.js';
import {
  matchNotifyToOrder,
  matchQueryToOrder,
  type PaymentIdentity,
} from './paymentMatch.js';

export type ApplyTradeResult =
  | { ok: true; order: OrderRow }
  | { ok: false; reason: string; orderMissing?: boolean };

function configuredIdentity(): { appId: string; sellerId?: string } | null {
  const s = loadAlipaySettings();
  if (!s) return null;
  return { appId: s.appId, sellerId: s.sellerId || undefined };
}

export function applyVerifiedTrade(input: {
  outTradeNo: string;
  tradeStatus?: string;
  tradeNo?: string;
  buyerLogonId?: string;
  identity: PaymentIdentity;
  rawNotify?: string;
  source: 'notify' | 'query';
}): ApplyTradeResult {
  const order = getOrderByOutTradeNo(input.outTradeNo);
  if (!order) {
    return { ok: false, reason: 'order_missing', orderMissing: true };
  }

  const configured = configuredIdentity();
  if (!configured) {
    return { ok: false, reason: 'alipay_unconfigured' };
  }

  const status = input.tradeStatus || '';
  const paid = isPaidStatus(status);

  if (paid) {
    const match =
      input.source === 'notify'
        ? matchNotifyToOrder(order, input.identity, configured)
        : matchQueryToOrder(order, input.identity, configured);
    if (!match.ok) {
      return { ok: false, reason: match.reason };
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

const lastAlipayQueryAt = new Map<string, number>();
export const PUBLIC_TRADE_QUERY_INTERVAL_MS = 8_000;

export function allowAlipayQuery(
  outTradeNo: string,
  intervalMs = PUBLIC_TRADE_QUERY_INTERVAL_MS,
  now = Date.now(),
): boolean {
  const prev = lastAlipayQueryAt.get(outTradeNo) ?? 0;
  if (now - prev < intervalMs) return false;
  lastAlipayQueryAt.set(outTradeNo, now);
  return true;
}

/** 仅用于测试：清空查单节流状态。 */
export function resetAlipayQueryThrottleForTests(): void {
  lastAlipayQueryAt.clear();
}
