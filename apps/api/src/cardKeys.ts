
import {
  addOrderItems,
  createOrder,
  getDb,
  getOrderByOutTradeNo,
  getOrderItems,
  getProductById,
  listPendingFulfillmentOrders,
  updateOrder,
  type OrderItemRow,
  type OrderRow,
  orderUsdtNetwork,
} from './db.js';
import { isUsdtPaymentChannel, paymentChannelLabel } from './paymentMethods.js';
import { buildUsdtQrContent, getUsdtNetwork, isUsdtNetworkId } from './usdtChains.js';
import { fenToYuan, yuanToFen } from './money.js';
import { CARD_IMPORT_MAX_CHARS } from './security.js';
import { formatCardKeyText, parseCardKeyLines } from './utils/cardKeyParse.js';
import {
  decryptCardSecret,
  encryptCardSecret,
  hashCardSecret,
} from './utils/cardSecret.js';

export type CardKeyStatus = 'unused' | 'sold' | 'disabled' | 'reserved';

export type CardKeyRow = {
  id: number;
  product_id: number;
  card_no: string | null;
  secret: string;
  status: CardKeyStatus;
  order_id: number | null;
  order_item_id: number | null;
  sold_at: string | null;
  reserved_until: string | null;
  created_at: string;
};

export type CardKeyAdminRow = CardKeyRow & {
  out_trade_no: string | null;
};

export type DeliveredKey = {
  id: number;
  productId: number | null;
  productName: string;
  cardNo: string | null;
  secret: string;
  text: string;
};

export type CheckoutLine = {
  productId: number;
  productName: string;
  coverUrl: string;
  unitPrice: string;
  quantity: number;
  lineTotalFen: number;
};

export const RESERVATION_TTL_MINUTES = 15;
/** 预占到期后再保留一段时间，避免支付宝/易支付迟到账通知时卡密已被释放。 */
export const RESERVATION_RELEASE_GRACE_MINUTES = 20;

export const PENDING_FULFILLMENT_MESSAGE =
  '部分或全部卡密暂未能自动发出。商家补货后系统会自动发卡，您也可以稍后再次查询订单。';

const PAID_STATUSES = new Set(['TRADE_SUCCESS', 'TRADE_FINISHED', 'SUCCESS']);
const FULFILLED = new Set(['delivered', 'pending_fulfillment', 'none']);

export class StockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StockError';
  }
}

export function isPaidStatus(status: string): boolean {
  return PAID_STATUSES.has(status);
}

function revealKey<T extends { secret: string }>(row: T): T {
  return { ...row, secret: decryptCardSecret(row.secret) };
}

export function syncProductStock(productId: number): number {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT COUNT(*) AS c FROM card_keys
       WHERE product_id = ? AND status = 'unused'`,
    )
    .get(productId) as { c: number };
  const count = row.c;
  db.prepare(
    `UPDATE products SET stock = ?, updated_at = datetime('now') WHERE id = ?`,
  ).run(count, productId);
  return count;
}

export function countUnusedKeys(productId: number): number {
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS c FROM card_keys
       WHERE product_id = ? AND status = 'unused'`,
    )
    .get(productId) as { c: number };
  return row.c;
}

export function countProductKeys(productId: number): number {
  const row = getDb()
    .prepare(`SELECT COUNT(*) AS c FROM card_keys WHERE product_id = ?`)
    .get(productId) as { c: number };
  return row.c;
}

export function listProductKeys(
  productId: number,
  status: CardKeyStatus | 'all' = 'all',
): CardKeyAdminRow[] {
  const sql =
    status === 'all'
      ? `SELECT k.id, k.product_id, k.card_no, k.secret, k.status, k.order_id,
                k.order_item_id, k.sold_at, k.reserved_until, k.created_at,
                o.out_trade_no
         FROM card_keys k
         LEFT JOIN orders o ON o.id = k.order_id
         WHERE k.product_id = ?
         ORDER BY k.status ASC, k.id DESC`
      : `SELECT k.id, k.product_id, k.card_no, k.secret, k.status, k.order_id,
                k.order_item_id, k.sold_at, k.reserved_until, k.created_at,
                o.out_trade_no
         FROM card_keys k
         LEFT JOIN orders o ON o.id = k.order_id
         WHERE k.product_id = ? AND k.status = ?
         ORDER BY k.id DESC`;
  const params = status === 'all' ? [productId] : [productId, status];
  return (getDb().prepare(sql).all(...params) as CardKeyAdminRow[]).map(
    revealKey,
  );
}

export function getKeysByOrderId(orderId: number): CardKeyRow[] {
  return (
    getDb()
      .prepare(
        `SELECT id, product_id, card_no, secret, status, order_id, order_item_id,
                sold_at, reserved_until, created_at
         FROM card_keys WHERE order_id = ? ORDER BY id ASC`,
      )
      .all(orderId) as CardKeyRow[]
  ).map(revealKey);
}

function getSoldKeysByOrderId(orderId: number): CardKeyRow[] {
  return getKeysByOrderId(orderId).filter((k) => k.status === 'sold');
}

export function importCardKeys(
  productId: number,
  text: string,
): { imported: number; skipped: number; total: number } {
  if (!getProductById(productId)) {
    throw new Error('商品不存在');
  }
  if (text.length > CARD_IMPORT_MAX_CHARS) {
    throw new Error(
      `导入内容过大，请控制在 ${CARD_IMPORT_MAX_CHARS} 个字符以内，分批导入`,
    );
  }
  const parsed = parseCardKeyLines(text);
  const insert = getDb().prepare(
    `INSERT OR IGNORE INTO card_keys(product_id, card_no, secret, secret_hash, status)
     VALUES(?, ?, ?, ?, 'unused')`,
  );
  let imported = 0;
  let skipped = 0;
  const run = getDb().transaction(() => {
    for (const row of parsed) {
      if (!row.secret) {
        skipped += 1;
        continue;
      }
      const info = insert.run(
        productId,
        row.cardNo,
        encryptCardSecret(row.secret),
        hashCardSecret(row.secret),
      );
      if (info.changes > 0) imported += 1;
      else skipped += 1;
    }
    syncProductStock(productId);
  });
  run();
  if (imported > 0) {
    autoFulfillPendingOrders({ productId });
  }
  return { imported, skipped, total: parsed.length };
}

export function deleteUnusedKey(productId: number, keyId: number): boolean {
  const run = getDb().transaction(() => {
    const info = getDb()
      .prepare(
        `DELETE FROM card_keys
         WHERE id = ? AND product_id = ? AND status IN ('unused', 'disabled')`,
      )
      .run(keyId, productId);
    if (info.changes > 0) syncProductStock(productId);
    return info.changes > 0;
  });
  return run();
}

export function deleteUnusedKeysOfProduct(productId: number): void {
  getDb()
    .prepare(
      `DELETE FROM card_keys WHERE product_id = ? AND status NOT IN ('sold', 'reserved')`,
    )
    .run(productId);
}

export type CheckoutValidation =
  | { ok: true; lines: CheckoutLine[] }
  | { ok: false; error: string };

export function validateCheckoutItems(
  items: Array<{ productId: number; quantity: number }>,
): CheckoutValidation {
  const lines: CheckoutLine[] = [];
  for (const it of items) {
    const p = getProductById(it.productId);
    if (!p || p.status !== 'on') {
      return { ok: false, error: `商品不可售（ID ${it.productId}）` };
    }
    const left = countUnusedKeys(p.id);
    if (left < it.quantity) {
      return {
        ok: false,
        error: `「${p.name}」卡密不足（剩余 ${left} 张）`,
      };
    }
    const unitFen = yuanToFen(p.price);
    lines.push({
      productId: p.id,
      productName: p.name,
      coverUrl: p.cover_url,
      unitPrice: p.price,
      quantity: it.quantity,
      lineTotalFen: unitFen * it.quantity,
    });
  }
  return { ok: true, lines };
}

const EXPIRED_RESERVATION_WHERE = `
  status = 'reserved'
    AND reserved_until IS NOT NULL
    AND reserved_until <= datetime('now', ?)
    AND NOT EXISTS (
      SELECT 1 FROM orders o
      WHERE o.id = card_keys.order_id
        AND o.payment_channel LIKE 'usdt_%'
        AND o.status IN ('WAIT_BUYER_PAY', 'PAYING', 'CREATED')
    )
`;

/**
 * 释放已过预占期且超过宽限的卡密。
 * 仍待支付的 USDT 订单在关单前不释放，避免宽限内到账后无卡可发。
 * excludeOrderId：履约本单时切勿把本单预占提前释放。
 */
export function releaseExpiredReservations(excludeOrderId?: number): number {
  const db = getDb();
  const grace = `-${RESERVATION_RELEASE_GRACE_MINUTES} minutes`;
  const run = db.transaction(() => {
    const exclude = excludeOrderId != null
      ? ` AND (order_id IS NULL OR order_id != ?)`
      : '';
    const rows = db
      .prepare(
        `SELECT DISTINCT product_id FROM card_keys
         WHERE ${EXPIRED_RESERVATION_WHERE}${exclude}`,
      )
      .all(
        ...(excludeOrderId != null ? [grace, excludeOrderId] : [grace]),
      ) as Array<{ product_id: number }>;
    if (!rows.length) return 0;
    const info = db
      .prepare(
        `UPDATE card_keys
         SET status = 'unused',
             order_id = NULL,
             order_item_id = NULL,
             reserved_until = NULL
         WHERE ${EXPIRED_RESERVATION_WHERE}${exclude}`,
      )
      .run(
        ...(excludeOrderId != null ? [grace, excludeOrderId] : [grace]),
      );
    for (const row of rows) syncProductStock(row.product_id);
    return info.changes;
  });
  return run.immediate();
}

export function releaseReservationsForOrder(orderId: number): void {
  const run = getDb().transaction(() => {
    const rows = getDb()
      .prepare(
        `SELECT DISTINCT product_id FROM card_keys
         WHERE order_id = ? AND status = 'reserved'`,
      )
      .all(orderId) as Array<{ product_id: number }>;
    getDb()
      .prepare(
        `UPDATE card_keys
         SET status = 'unused',
             order_id = NULL,
             order_item_id = NULL,
             reserved_until = NULL
         WHERE order_id = ? AND status = 'reserved'`,
      )
      .run(orderId);
    for (const row of rows) syncProductStock(row.product_id);
  });
  run.immediate();
}

export function checkoutSubject(lines: CheckoutLine[]): string {
  if (lines.length === 1) return lines[0].productName;
  return `即码小店·${lines[0].productName}等${lines.length}件`;
}

export function createReservedCheckoutOrder(input: {
  outTradeNo: string;
  subject?: string;
  buyerNote?: string | null;
  paymentChannel?: string;
  paymentLabel?: string | null;
  reservationMinutes?: number;
  items: Array<{ productId: number; quantity: number }>;
}): { order: OrderRow; lines: CheckoutLine[]; totalAmount: string; subject: string } {
  const run = getDb().transaction(() => {
    releaseExpiredReservations();
    const checked = validateCheckoutItems(input.items);
    if (!checked.ok) throw new StockError(checked.error);
    const lines = checked.lines;
    const totalFen = lines.reduce((s, l) => s + l.lineTotalFen, 0);
    if (totalFen < 1) throw new StockError('订单金额过低');
    const totalAmount = fenToYuan(totalFen);
    const subject = input.subject || checkoutSubject(lines);

    const order = createOrder({
      outTradeNo: input.outTradeNo,
      subject,
      totalAmount,
      qrCode: null,
      status: 'WAIT_BUYER_PAY',
      buyerNote: input.buyerNote ?? null,
      paymentChannel: input.paymentChannel,
      paymentLabel: input.paymentLabel ?? null,
    });
    addOrderItems(
      order.id,
      lines.map((l) => ({
        productId: l.productId,
        productName: l.productName,
        coverUrl: l.coverUrl,
        unitPrice: l.unitPrice,
        quantity: l.quantity,
      })),
    );

    const orderItems = getOrderItems(order.id);
    const pick = getDb().prepare(
      `SELECT id FROM card_keys
       WHERE product_id = ? AND status = 'unused'
       ORDER BY id ASC
       LIMIT ?`,
    );
    const reserve = getDb().prepare(
      `UPDATE card_keys
       SET status = 'reserved',
           order_id = ?,
           order_item_id = ?,
           reserved_until = datetime('now', ?)
       WHERE id = ? AND status = 'unused'`,
    );
    const minutes = Math.max(
      1,
      Math.floor(input.reservationMinutes ?? RESERVATION_TTL_MINUTES),
    );
    const ttl = `+${minutes} minutes`;

    for (const it of orderItems) {
      if (!it.product_id) {
        throw new StockError(`「${it.product_name}」库存不足`);
      }
      const rows = pick.all(it.product_id, it.quantity) as Array<{ id: number }>;
      if (rows.length < it.quantity) {
        throw new StockError(
          `「${it.product_name}」卡密不足（剩余 ${rows.length} 张）`,
        );
      }
      for (const row of rows) {
        const info = reserve.run(order.id, it.id, ttl, row.id);
        if (info.changes !== 1) {
          throw new StockError(`「${it.product_name}」库存不足`);
        }
      }
      syncProductStock(it.product_id);
    }

    return { order, lines, totalAmount, subject };
  });
  return run.immediate();
}

function deliveredKeysForOrder(
  orderId: number,
  items: OrderItemRow[],
): DeliveredKey[] {
  const nameByProduct = new Map<number, string>();
  const nameByItem = new Map<number, string>();
  for (const it of items) {
    nameByItem.set(it.id, it.product_name);
    if (it.product_id) nameByProduct.set(it.product_id, it.product_name);
  }
  return getSoldKeysByOrderId(orderId).map((k) => {
    const productName =
      (k.order_item_id ? nameByItem.get(k.order_item_id) : undefined) ||
      nameByProduct.get(k.product_id) ||
      '卡密商品';
    return {
      id: k.id,
      productId: k.product_id,
      productName,
      cardNo: k.card_no,
      secret: k.secret,
      text: formatCardKeyText(k.card_no, k.secret),
    };
  });
}

/**
 * 支付成功后发卡。使用 BEGIN IMMEDIATE 避免超卖。
 * 优先把本单预占卡密转为已售，不足再从未用库存补齐。
 * 幂等：若该订单已尝试发货（已有 fulfillment_status），不再重复分配。
 */
export function markOrderPaidAndDeliverKeys(
  outTradeNo: string,
  patch: {
    trade_no?: string;
    buyer_logon_id?: string;
    raw_notify?: string;
    status?: string;
    usdt_tx_hash?: string;
  },
): { assigned: number; fulfillmentStatus: string } {
  const run = getDb().transaction(() => {
    const order = getOrderByOutTradeNo(outTradeNo);
    if (!order) {
      return { assigned: 0, fulfillmentStatus: 'none' };
    }
    // 先不释放本单预占：预占过期后迟到的支付通知仍应发出原卡密。
    releaseExpiredReservations(order.id);

    const alreadyAttempted = FULFILLED.has(order.fulfillment_status);

    updateOrder(outTradeNo, {
      status: patch.status || 'TRADE_SUCCESS',
      trade_no: patch.trade_no,
      buyer_logon_id: patch.buyer_logon_id,
      raw_notify: patch.raw_notify,
      usdt_tx_hash: patch.usdt_tx_hash,
    });

    if (alreadyAttempted) {
      return {
        assigned: getSoldKeysByOrderId(order.id).length,
        fulfillmentStatus: order.fulfillment_status || 'delivered',
      };
    }

    const items = getOrderItems(order.id);
    if (!items.length) {
      updateOrder(outTradeNo, { fulfillment_status: 'none' });
      return { assigned: 0, fulfillmentStatus: 'none' };
    }

    getDb()
      .prepare(
        `UPDATE card_keys
         SET status = 'sold',
             sold_at = datetime('now'),
             reserved_until = NULL
         WHERE order_id = ? AND status = 'reserved'`,
      )
      .run(order.id);

    let shortfall = false;
    const countForItem = getDb().prepare(
      `SELECT COUNT(*) AS c FROM card_keys
       WHERE order_item_id = ? AND status = 'sold'`,
    );
    const claim = getDb().prepare(
      `UPDATE card_keys
       SET status = 'sold',
           order_id = ?,
           order_item_id = ?,
           sold_at = datetime('now'),
           reserved_until = NULL
       WHERE id = ? AND status = 'unused'`,
    );
    const pick = getDb().prepare(
      `SELECT id FROM card_keys
       WHERE product_id = ? AND status = 'unused'
       ORDER BY id ASC
       LIMIT ?`,
    );

    const touched = new Set<number>();
    let assigned = 0;
    for (const it of items) {
      if (!it.product_id) {
        shortfall = true;
        continue;
      }
      touched.add(it.product_id);
      const have = (countForItem.get(it.id) as { c: number }).c;
      assigned += have;
      const need = it.quantity - have;
      if (need <= 0) continue;
      const rows = pick.all(it.product_id, need) as Array<{ id: number }>;
      if (rows.length < need) shortfall = true;
      for (const row of rows) {
        const info = claim.run(order.id, it.id, row.id);
        if (info.changes > 0) assigned += 1;
        else shortfall = true;
      }
    }

    for (const productId of touched) {
      syncProductStock(productId);
    }

    const fulfillmentStatus = shortfall ? 'pending_fulfillment' : 'delivered';
    updateOrder(outTradeNo, { fulfillment_status: fulfillmentStatus });
    return { assigned, fulfillmentStatus };
  });

  return run.immediate();
}

export function fulfillPendingOrder(outTradeNo: string): {
  assigned: number;
  added: number;
  fulfillmentStatus: string;
} {
  const run = getDb().transaction(() => {
    const order = getOrderByOutTradeNo(outTradeNo);
    if (!order) {
      throw new Error('订单不存在');
    }
    if (!isPaidStatus(order.status)) {
      throw new Error('订单未支付，无法补发');
    }
    if (
      order.fulfillment_status === 'delivered' ||
      order.fulfillment_status === 'none'
    ) {
      return {
        assigned: getSoldKeysByOrderId(order.id).length,
        added: 0,
        fulfillmentStatus: order.fulfillment_status || 'delivered',
      };
    }
    if (order.fulfillment_status !== 'pending_fulfillment') {
      throw new Error('当前订单无需补发');
    }

    const items = getOrderItems(order.id);
    const countForItem = getDb().prepare(
      `SELECT COUNT(*) AS c FROM card_keys
       WHERE order_item_id = ? AND status = 'sold'`,
    );
    const claim = getDb().prepare(
      `UPDATE card_keys
       SET status = 'sold',
           order_id = ?,
           order_item_id = ?,
           sold_at = datetime('now'),
           reserved_until = NULL
       WHERE id = ? AND status = 'unused'`,
    );
    const pick = getDb().prepare(
      `SELECT id FROM card_keys
       WHERE product_id = ? AND status = 'unused'
       ORDER BY id ASC
       LIMIT ?`,
    );

    const touched = new Set<number>();
    let added = 0;
    let shortfall = false;
    for (const it of items) {
      if (!it.product_id) {
        shortfall = true;
        continue;
      }
      touched.add(it.product_id);
      const have = (countForItem.get(it.id) as { c: number }).c;
      const need = it.quantity - have;
      if (need <= 0) continue;
      const rows = pick.all(it.product_id, need) as Array<{ id: number }>;
      if (rows.length < need) shortfall = true;
      for (const row of rows) {
        const info = claim.run(order.id, it.id, row.id);
        if (info.changes > 0) added += 1;
        else shortfall = true;
      }
    }

    for (const productId of touched) syncProductStock(productId);

    const assigned = getSoldKeysByOrderId(order.id).length;
    const fulfillmentStatus =
      !shortfall && assigned >= items.reduce((s, it) => s + it.quantity, 0)
        ? 'delivered'
        : 'pending_fulfillment';
    updateOrder(outTradeNo, { fulfillment_status: fulfillmentStatus });
    return { assigned, added, fulfillmentStatus };
  });
  return run.immediate();
}

/**
 * 对已支付且待补发的订单尝试自动发卡。库存不足则保持待补发；已发齐则不再重复分配。
 */
export function autoFulfillPendingOrders(opts?: {
  productId?: number;
  outTradeNo?: string;
}): { tried: number; delivered: number } {
  let orders: OrderRow[];
  if (opts?.outTradeNo) {
    const one = getOrderByOutTradeNo(opts.outTradeNo);
    orders = one ? [one] : [];
  } else {
    orders = listPendingFulfillmentOrders();
  }
  let tried = 0;
  let delivered = 0;
  for (const order of orders) {
    if (!isPaidStatus(order.status)) continue;
    if (order.fulfillment_status !== 'pending_fulfillment') continue;
    if (opts?.productId) {
      const items = getOrderItems(order.id);
      if (!items.some((it) => it.product_id === opts.productId)) continue;
    }
    tried += 1;
    try {
      const result = fulfillPendingOrder(order.out_trade_no);
      if (result.fulfillmentStatus === 'delivered') delivered += 1;
    } catch {
      /* 单笔失败不影响其余待补发订单 */
    }
  }
  return { tried, delivered };
}

export type PublicOrderView = {
  outTradeNo: string;
  subject: string;
  totalAmount: string;
  status: string;
  tradeNo: string | null;
  qrCode: string | null;
  fulfillmentStatus: string;
  paid: boolean;
  keys: DeliveredKey[];
  items: Array<{
    productName: string;
    unitPrice: string;
    quantity: number;
    coverUrl: string;
  }>;
  message?: string;
  payMethod?: string;
  usdt?: {
    address: string;
    amount: string;
    network: string;
    expireAt?: string;
    paymentUrl?: string;
    qrContent: string;
  };
};

export function getPublicOrderView(outTradeNo: string): PublicOrderView | null {
  autoFulfillPendingOrders({ outTradeNo });
  const order = getOrderByOutTradeNo(outTradeNo);
  if (!order) return null;
  const paid = isPaidStatus(order.status);
  const items = getOrderItems(order.id);
  const keys = paid ? deliveredKeysForOrder(order.id, items) : [];
  let message: string | undefined;
  if (paid && order.fulfillment_status === 'pending_fulfillment') {
    message = PENDING_FULFILLMENT_MESSAGE;
  }
  return {
    outTradeNo: order.out_trade_no,
    subject: order.subject,
    totalAmount: order.total_amount,
    status: order.status,
    tradeNo: paid ? order.trade_no : null,
    qrCode: order.qr_code,
    fulfillmentStatus: order.fulfillment_status || (paid ? 'none' : ''),
    paid,
    keys,
    items: items.map((it) => ({
      productName: it.product_name,
      unitPrice: it.unit_price,
      quantity: it.quantity,
      coverUrl: it.cover_url,
    })),
    message,
    payMethod: paymentChannelLabel(order.payment_channel, order.payment_label),
    usdt:
      isUsdtPaymentChannel(order.payment_channel) && order.usdt_address && !paid
        ? (() => {
            const networkId = orderUsdtNetwork(order);
            const def = networkId && isUsdtNetworkId(networkId) ? getUsdtNetwork(networkId) : null;
            return {
              address: order.usdt_address,
              amount: order.usdt_amount || '',
              network: def?.displayNetwork || 'USDT',
              expireAt: order.usdt_expire_at || undefined,
              qrContent:
                networkId && isUsdtNetworkId(networkId)
                  ? buildUsdtQrContent(networkId, order.usdt_address, order.usdt_amount || undefined)
                  : order.usdt_address,
            };
          })()
        : undefined,
  };
}

export function attachKeysToOrders<T extends OrderRow>(
  orders: Array<T & { items: OrderItemRow[] }>,
): Array<
  T & {
    items: OrderItemRow[];
    keys: DeliveredKey[];
  }
> {
  return orders.map((o) => ({
    ...o,
    keys: deliveredKeysForOrder(o.id, o.items),
  }));
}

let releaserTimer: ReturnType<typeof setInterval> | null = null;

export function startReservationReleaser(intervalMs = 60_000): void {
  if (releaserTimer) return;
  const tick = () => {
    try {
      releaseExpiredReservations();
    } catch (err) {
      console.error('[reservations] 释放过期预占失败', err);
    }
    try {
      autoFulfillPendingOrders();
    } catch (err) {
      console.error('[fulfillment] 自动补发失败', err);
    }
  };
  tick();
  releaserTimer = setInterval(tick, intervalMs);
  releaserTimer.unref?.();
}
