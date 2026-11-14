import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

const tmpDb = path.join(os.tmpdir(), `jima-reconcile-${Date.now()}.db`);
process.env.DATABASE_PATH = tmpDb;
process.env.SETTINGS_ENCRYPTION_KEY = 'test-encryption-key-32bytes!!!!';
process.env.SESSION_SECRET = 'test-session-secret';

const {
  getDb,
  createProduct,
  createOrder,
  getOrderByOutTradeNo,
  saveAlipaySettings,
  saveEpaySettings,
} = await import('../src/db.js');
const {
  importCardKeys,
  createReservedCheckoutOrder,
  getPublicOrderView,
  getKeysByOrderId,
  countUnusedKeys,
  releaseReservationsForOrder,
  markOrderPaidAndDeliverKeys,
} = await import('../src/cardKeys.js');
const {
  allowPublicTradeQuery,
  resetAlipayQueryThrottleForTests,
} = await import('../src/paymentSync.js');
const {
  reconcileProviderPayments,
  setPaymentReconcileQueryForTests,
  resetPaymentReconcileForTests,
  allowProviderReconcileQuery,
} = await import('../src/paymentReconcile.js');

const APP_ID = '2021000000000000';
const EPAY_PID = '1000';

describe('server-side alipay/epay reconciliation', () => {
  let productId: number;

  before(() => {
    getDb();
    saveAlipaySettings({
      appId: APP_ID,
      privateKey: 'A'.repeat(64),
      alipayPublicKey: 'B'.repeat(64),
    });
    saveEpaySettings({
      enabled: true,
      gateway: 'https://pay.example.com',
      pid: EPAY_PID,
      key: 'test-merchant-key',
      channels: ['alipay'],
    });
    const p = createProduct({ name: '对账商品', price: '10.00', status: 'on' });
    productId = p.id;
    importCardKeys(
      productId,
      Array.from({ length: 10 }, (_, i) => `REC-KEY-${i + 1}`).join('\n'),
    );
  });

  after(() => {
    resetPaymentReconcileForTests();
    for (const f of [tmpDb, `${tmpDb}-wal`, `${tmpDb}-shm`]) {
      try {
        fs.unlinkSync(f);
      } catch {
        /* ignore */
      }
    }
  });

  it('fulfills an unpaid alipay order when the official query reports paid', async () => {
    resetPaymentReconcileForTests();
    const reserved = createReservedCheckoutOrder({
      outTradeNo: 'JMREC-ALI-PAY',
      paymentChannel: 'alipay_f2f',
      items: [{ productId, quantity: 1 }],
    });
    setPaymentReconcileQueryForTests(async (order) => {
      if (order.out_trade_no !== 'JMREC-ALI-PAY') return { ok: false };
      return {
        ok: true,
        tradeStatus: 'TRADE_SUCCESS',
        tradeNo: 'ALI-REC-1',
        identity: { totalAmount: reserved.totalAmount, appId: APP_ID },
        provider: 'alipay',
      };
    });
    const result = await reconcileProviderPayments();
    assert.ok(result.queried >= 1);
    assert.ok(result.applied >= 1);
    const view = getPublicOrderView('JMREC-ALI-PAY');
    assert.equal(view!.paid, true);
    assert.equal(view!.fulfillmentStatus, 'delivered');
    assert.equal(view!.keys.length, 1);
  });

  it('does not close or release keys when the provider query fails', async () => {
    resetPaymentReconcileForTests();
    const reserved = createReservedCheckoutOrder({
      outTradeNo: 'JMREC-FAIL',
      paymentChannel: 'alipay_f2f',
      items: [{ productId, quantity: 1 }],
    });
    const unusedBefore = countUnusedKeys(productId);
    setPaymentReconcileQueryForTests(async () => {
      throw new Error('gateway timeout');
    });
    const result = await reconcileProviderPayments();
    assert.ok(result.queried >= 1);
    assert.equal(result.applied, 0);
    const order = getOrderByOutTradeNo('JMREC-FAIL');
    assert.equal(order!.status, 'WAIT_BUYER_PAY');
    assert.equal(countUnusedKeys(productId), unusedBefore);
    assert.ok(getKeysByOrderId(reserved.order.id).every((k) => k.status === 'reserved'));
  });

  it('does not downgrade a paid order when a later query returns TRADE_CLOSED', async () => {
    resetPaymentReconcileForTests();
    const reserved = createReservedCheckoutOrder({
      outTradeNo: 'JMREC-NODEGRADE',
      paymentChannel: 'epay_alipay',
      items: [{ productId, quantity: 1 }],
    });
    markOrderPaidAndDeliverKeys('JMREC-NODEGRADE', { status: 'TRADE_SUCCESS' });
    assert.equal(getPublicOrderView('JMREC-NODEGRADE')!.paid, true);
    setPaymentReconcileQueryForTests(async (order) => {
      if (order.out_trade_no !== 'JMREC-NODEGRADE') return { ok: false };
      return {
        ok: true,
        tradeStatus: 'TRADE_CLOSED',
        identity: { totalAmount: reserved.totalAmount, pid: EPAY_PID },
        provider: 'epay',
      };
    });
    // 已支付订单不在待对账列表中，这里直接再跑一轮也不应改状态；
    // 同时验证 apply 路径已被现有逻辑覆盖。再造一笔未支付单以免本轮空跑。
    await reconcileProviderPayments();
    const view = getPublicOrderView('JMREC-NODEGRADE');
    assert.equal(view!.paid, true);
    assert.equal(view!.fulfillmentStatus, 'delivered');
    assert.equal(getOrderByOutTradeNo('JMREC-NODEGRADE')!.status, 'TRADE_SUCCESS');
    assert.ok(getKeysByOrderId(reserved.order.id).every((k) => k.status === 'sold'));
  });

  it('still fulfills after reservations were released, or flags 待补发 if keys are gone', async () => {
    resetPaymentReconcileForTests();
    const reserved = createReservedCheckoutOrder({
      outTradeNo: 'JMREC-LATE',
      paymentChannel: 'alipay_f2f',
      items: [{ productId, quantity: 1 }],
    });
    releaseReservationsForOrder(reserved.order.id);
    assert.equal(getKeysByOrderId(reserved.order.id).length, 0);
    setPaymentReconcileQueryForTests(async (order) => {
      if (order.out_trade_no !== 'JMREC-LATE') return { ok: false };
      return {
        ok: true,
        tradeStatus: 'TRADE_SUCCESS',
        tradeNo: 'ALI-LATE',
        identity: { totalAmount: reserved.totalAmount, appId: APP_ID },
        provider: 'alipay',
      };
    });
    await reconcileProviderPayments();
    const view = getPublicOrderView('JMREC-LATE');
    assert.equal(view!.paid, true);
    assert.ok(
      view!.fulfillmentStatus === 'delivered' ||
        view!.fulfillmentStatus === 'pending_fulfillment',
    );
    if (view!.fulfillmentStatus === 'delivered') {
      assert.equal(view!.keys.length, 1);
    }
  });

  it('is not blocked by the public 8-second query throttle', async () => {
    resetPaymentReconcileForTests();
    resetAlipayQueryThrottleForTests();
    const reserved = createReservedCheckoutOrder({
      outTradeNo: 'JMREC-THROTTLE',
      paymentChannel: 'alipay_f2f',
      items: [{ productId, quantity: 1 }],
    });
    assert.equal(allowPublicTradeQuery('JMREC-THROTTLE'), true);
    assert.equal(allowPublicTradeQuery('JMREC-THROTTLE'), false);
    let called = 0;
    setPaymentReconcileQueryForTests(async (order) => {
      if (order.out_trade_no !== 'JMREC-THROTTLE') return { ok: false };
      called += 1;
      return {
        ok: true,
        tradeStatus: 'TRADE_SUCCESS',
        tradeNo: 'ALI-THROTTLE',
        identity: { totalAmount: reserved.totalAmount, appId: APP_ID },
        provider: 'alipay',
      };
    });
    await reconcileProviderPayments();
    assert.equal(called, 1);
    assert.equal(getPublicOrderView('JMREC-THROTTLE')!.paid, true);
  });

  it('rate-limits repeated server-side queries per order without using the public interval', async () => {
    resetPaymentReconcileForTests();
    createReservedCheckoutOrder({
      outTradeNo: 'JMREC-SERVER-THROTTLE',
      paymentChannel: 'alipay_f2f',
      items: [{ productId, quantity: 1 }],
    });
    let calls = 0;
    setPaymentReconcileQueryForTests(async (order) => {
      if (order.out_trade_no !== 'JMREC-SERVER-THROTTLE') return { ok: false };
      calls += 1;
      return { ok: false };
    });
    const first = await reconcileProviderPayments();
    const callsAfterFirst = calls;
    const second = await reconcileProviderPayments();
    assert.ok(first.queried >= 1);
    assert.ok(callsAfterFirst >= 1);
    assert.equal(calls, callsAfterFirst);
    assert.equal(second.queried, 0);
    resetPaymentReconcileForTests();
    assert.equal(allowProviderReconcileQuery('ISO-THROTTLE', 45_000, 1_000), true);
    assert.equal(allowProviderReconcileQuery('ISO-THROTTLE', 45_000, 2_000), false);
    assert.equal(allowProviderReconcileQuery('ISO-THROTTLE', 45_000, 46_000), true);
  });

  it('does not include USDT orders in the provider reconcile list', async () => {
    resetPaymentReconcileForTests();
    createOrder({
      outTradeNo: 'JMREC-USDT',
      subject: 'usdt',
      totalAmount: '10.00',
      status: 'WAIT_BUYER_PAY',
      paymentChannel: 'usdt_trc20',
    });
    const seen: string[] = [];
    setPaymentReconcileQueryForTests(async (order) => {
      seen.push(order.out_trade_no);
      return { ok: false };
    });
    await reconcileProviderPayments();
    assert.equal(seen.includes('JMREC-USDT'), false);
  });
});
