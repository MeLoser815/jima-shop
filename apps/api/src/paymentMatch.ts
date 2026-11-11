import { yuanToFen } from './money.js';

export type PaymentIdentity = {
  totalAmount?: string;
  appId?: string;
  sellerId?: string;
};

export type PaymentMatchResult =
  | { ok: true }
  | { ok: false; reason: string };

export type ConfiguredAlipay = {
  appId: string;
  sellerId?: string;
};

function compareAmount(
  orderAmount: string,
  paymentAmount: string | undefined,
  required: boolean,
): PaymentMatchResult | null {
  if (paymentAmount == null || paymentAmount === '') {
    return required
      ? { ok: false, reason: 'amount_missing' }
      : null;
  }
  try {
    if (yuanToFen(paymentAmount) !== yuanToFen(orderAmount)) {
      return { ok: false, reason: 'amount_mismatch' };
    }
  } catch {
    return { ok: false, reason: 'amount_invalid' };
  }
  return null;
}

function compareAppId(
  configured: string,
  paymentAppId: string | undefined,
  required: boolean,
): PaymentMatchResult | null {
  if (paymentAppId == null || paymentAppId === '') {
    return required ? { ok: false, reason: 'app_id_missing' } : null;
  }
  if (paymentAppId !== configured) {
    return { ok: false, reason: 'app_id_mismatch' };
  }
  return null;
}

function compareSellerId(
  configured: string | undefined,
  paymentSellerId: string | undefined,
): PaymentMatchResult | null {
  if (!paymentSellerId || !configured) return null;
  if (paymentSellerId !== configured) {
    return { ok: false, reason: 'seller_id_mismatch' };
  }
  return null;
}

/** 异步通知：金额与 app_id 必须出现且一致；seller_id 仅在双方都有时核对。 */
export function matchNotifyToOrder(
  order: { total_amount: string },
  payment: PaymentIdentity,
  configured: ConfiguredAlipay,
): PaymentMatchResult {
  return (
    compareAmount(order.total_amount, payment.totalAmount, true) ||
    compareAppId(configured.appId, payment.appId, true) ||
    compareSellerId(configured.sellerId, payment.sellerId) || { ok: true }
  );
}

/** 主动查单：金额必须一致；app_id / seller_id 仅在返回中出现时核对。 */
export function matchQueryToOrder(
  order: { total_amount: string },
  payment: PaymentIdentity,
  configured: ConfiguredAlipay,
): PaymentMatchResult {
  return (
    compareAmount(order.total_amount, payment.totalAmount, true) ||
    compareAppId(configured.appId, payment.appId, false) ||
    compareSellerId(configured.sellerId, payment.sellerId) || { ok: true }
  );
}

export function paymentIdentityFromNotify(
  params: Record<string, string>,
): PaymentIdentity {
  return {
    totalAmount: params.total_amount,
    appId: params.app_id,
    sellerId: params.seller_id,
  };
}
