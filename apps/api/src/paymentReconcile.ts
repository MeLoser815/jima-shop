import {
  getOrderByOutTradeNo,
  listPendingProviderPaymentOrders,
  type OrderRow,
} from './db.js';
import { tradeQuery } from './alipay.js';
import { epayQuery } from './epay.js';
import { isEpayPaymentChannel } from './paymentMethods.js';
import { applyVerifiedTrade } from './paymentSync.js';

/** 服务端对账周期。与面向买家的 8 秒公开查单节流相互独立。 */
export const PAYMENT_RECONCILE_INTERVAL_MS = 30_000;
/** 同一订单两次渠道查单的最小间隔，避免打爆官方/易支付接口。 */
export const PAYMENT_RECONCILE_ORDER_INTERVAL_MS = 45_000;
/** 每轮最多查询的未支付订单数。 */
export const PAYMENT_RECONCILE_BATCH = 15;
/** 只对账创建不超过该天数的待付单。 */
export const PAYMENT_RECONCILE_MAX_AGE_DAYS = 7;

export type ProviderReconcileQueryResult =
  | {
      ok: true;
      tradeStatus?: string;
      tradeNo?: string;
      buyerLogonId?: string;
      identity: {
        totalAmount?: string;
        appId?: string;
        sellerId?: string;
        pid?: string;
      };
      provider: 'alipay' | 'epay';
    }
  | { ok: false };

export type ProviderReconcileQueryFn = (
  order: OrderRow,
) => Promise<ProviderReconcileQueryResult>;

let queryOverride: ProviderReconcileQueryFn | null = null;
const lastReconcileAt = new Map<string, number>();
let reconcileInFlight: Promise<{ queried: number; applied: number }> | null =
  null;
let reconcileTimer: ReturnType<typeof setInterval> | null = null;

export function setPaymentReconcileQueryForTests(
  fn: ProviderReconcileQueryFn | null,
): void {
  queryOverride = fn;
}

export function resetPaymentReconcileForTests(): void {
  lastReconcileAt.clear();
  queryOverride = null;
  reconcileInFlight = null;
}

export function allowProviderReconcileQuery(
  outTradeNo: string,
  intervalMs = PAYMENT_RECONCILE_ORDER_INTERVAL_MS,
  now = Date.now(),
): boolean {
  const prev = lastReconcileAt.get(outTradeNo);
  if (prev != null && now - prev < intervalMs) return false;
  lastReconcileAt.set(outTradeNo, now);
  return true;
}

async function defaultQueryOrder(
  order: OrderRow,
): Promise<ProviderReconcileQueryResult> {
  if (isEpayPaymentChannel(order.payment_channel)) {
    const result = await epayQuery(order.out_trade_no);
    if (!result.ok || !result.tradeStatus) return { ok: false };
    return {
      ok: true,
      tradeStatus: result.tradeStatus,
      tradeNo: result.tradeNo,
      identity: {
        totalAmount: result.money,
        pid: result.pid,
      },
      provider: 'epay',
    };
  }
  if (order.payment_channel === 'alipay_f2f') {
    const result = await tradeQuery(order.out_trade_no);
    if (!result.ok || !result.tradeStatus) return { ok: false };
    return {
      ok: true,
      tradeStatus: result.tradeStatus,
      tradeNo: result.tradeNo,
      buyerLogonId: result.buyerLogonId,
      identity: {
        totalAmount: result.totalAmount,
        appId: result.appId,
        sellerId: result.sellerId,
      },
      provider: 'alipay',
    };
  }
  return { ok: false };
}

export async function reconcileProviderPayments(
  now = new Date(),
): Promise<{ queried: number; applied: number }> {
  if (reconcileInFlight) return reconcileInFlight;
  reconcileInFlight = doReconcileProviderPayments(now).finally(() => {
    reconcileInFlight = null;
  });
  return reconcileInFlight;
}

async function doReconcileProviderPayments(
  now: Date,
): Promise<{ queried: number; applied: number }> {
  const pending = listPendingProviderPaymentOrders(
    PAYMENT_RECONCILE_MAX_AGE_DAYS,
  );
  const nowMs = now.getTime();
  const due = pending.filter((order) =>
    allowProviderReconcileQuery(
      order.out_trade_no,
      PAYMENT_RECONCILE_ORDER_INTERVAL_MS,
      nowMs,
    ),
  );
  const batch = due.slice(0, PAYMENT_RECONCILE_BATCH);
  let queried = 0;
  let applied = 0;
  const query = queryOverride ?? defaultQueryOrder;

  for (const order of batch) {
    queried += 1;
    let result: ProviderReconcileQueryResult;
    try {
      result = await query(order);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(
        '[payment-reconcile] 查单失败，本轮不关单',
        order.out_trade_no,
        msg,
      );
      continue;
    }
    if (!result.ok || !result.tradeStatus) continue;
    const before = getOrderByOutTradeNo(order.out_trade_no);
    const appliedResult = applyVerifiedTrade({
      outTradeNo: order.out_trade_no,
      tradeStatus: result.tradeStatus,
      tradeNo: result.tradeNo,
      buyerLogonId: result.buyerLogonId,
      identity: result.identity,
      source: 'query',
      provider: result.provider,
    });
    if (!appliedResult.ok) {
      console.warn(
        '[payment-reconcile] 查单结果未写入',
        order.out_trade_no,
        appliedResult.reason,
      );
      continue;
    }
    const after = appliedResult.order;
    if (
      before &&
      after &&
      (before.status !== after.status ||
        before.fulfillment_status !== after.fulfillment_status)
    ) {
      applied += 1;
    }
  }
  return { queried, applied };
}

export function startPaymentReconciler(
  intervalMs = PAYMENT_RECONCILE_INTERVAL_MS,
): void {
  if (reconcileTimer) return;
  const tick = () => {
    void (async () => {
      try {
        await reconcileProviderPayments();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[payment-reconcile] 对账失败', msg);
      }
    })();
  };
  tick();
  reconcileTimer = setInterval(tick, intervalMs);
  reconcileTimer.unref?.();
}
