import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

const tmpDb = path.join(os.tmpdir(), `jima-keys-${Date.now()}.db`);
process.env.DATABASE_PATH = tmpDb;
process.env.SETTINGS_ENCRYPTION_KEY = 'test-encryption-key-32bytes!!!!';
process.env.SESSION_SECRET = 'test-session-secret';

const {
  parseCardKeyLines,
  parseCardKeyLine,
} = await import('../src/utils/cardKeyParse.js');
const { getDb, createProduct, getProductById, createOrder, addOrderItems } =
  await import('../src/db.js');
const {
  importCardKeys,
  countUnusedKeys,
  listProductKeys,
  deleteUnusedKey,
  validateCheckoutItems,
  markOrderPaidAndDeliverKeys,
  getKeysByOrderId,
  getPublicOrderView,
  createReservedCheckoutOrder,
  releaseReservationsForOrder,
  releaseExpiredReservations,
  fulfillPendingOrder,
  StockError,
  PENDING_FULFILLMENT_MESSAGE,
} = await import('../src/cardKeys.js');

describe('card key parse', () => {
  it('parses common formats and skips empty lines', () => {
    const rows = parseCardKeyLines(
      [
        'AAAA-BBBB-CCCC',
        '',
        '  ',
        'CARD01,SECRET01',
        'CARD02----SECRET02',
        'CARD03\tSECRET03',
        'CARD04 SECRET04',
        'PLAIN KEY WITH SPACES MORE',
      ].join('\n'),
    );
    assert.deepEqual(rows, [
      { cardNo: null, secret: 'AAAA-BBBB-CCCC' },
      { cardNo: 'CARD01', secret: 'SECRET01' },
      { cardNo: 'CARD02', secret: 'SECRET02' },
      { cardNo: 'CARD03', secret: 'SECRET03' },
      { cardNo: 'CARD04', secret: 'SECRET04' },
      { cardNo: null, secret: 'PLAIN KEY WITH SPACES MORE' },
    ]);
    assert.equal(parseCardKeyLine('x----y').secret, 'y');
  });
});

describe('card key inventory & delivery', () => {
  let productId: number;

  before(() => {
    getDb();
    const p = createProduct({
      name: '测试卡密商品',
      price: '10.00',
      status: 'on',
    });
    productId = p.id;
    assert.equal(p.stock, 0);
  });

  after(() => {
    for (const f of [tmpDb, tmpDb + '-wal', tmpDb + '-shm']) {
      try {
        fs.unlinkSync(f);
      } catch {
        /* ignore */
      }
    }
  });

  it('imports keys and skips duplicates', () => {
    const first = importCardKeys(
      productId,
      ['AAAA-1111', 'CARD01,SECRET01', 'CARD02----SECRET02', 'CARD03\tSECRET03'].join(
        '\n',
      ),
    );
    assert.equal(first.imported, 4);
    assert.equal(first.skipped, 0);
    assert.equal(countUnusedKeys(productId), 4);
    assert.equal(getProductById(productId)?.stock, 4);

    const second = importCardKeys(
      productId,
      ['AAAA-1111', 'CARD01,SECRET01', 'NEW-ONLY'].join('\n'),
    );
    assert.equal(second.imported, 1);
    assert.equal(second.skipped, 2);
    assert.equal(countUnusedKeys(productId), 5);
    assert.equal(getProductById(productId)?.stock, 5);
  });

  it('rejects checkout when unused keys are insufficient', () => {
    const ok = validateCheckoutItems([{ productId, quantity: 2 }]);
    assert.equal(ok.ok, true);
    const fail = validateCheckoutItems([{ productId, quantity: 99 }]);
    assert.equal(fail.ok, false);
    if (!fail.ok) {
      assert.match(fail.error, /卡密不足/);
      assert.match(fail.error, /剩余 5 张/);
    }
  });

  it('assigns keys on pay and is idempotent on a second notify', () => {
    const order = createOrder({
      outTradeNo: 'TESTKEY001',
      subject: '测试卡密商品',
      totalAmount: '20.00',
      status: 'WAIT_BUYER_PAY',
    });
    addOrderItems(order.id, [
      {
        productId,
        productName: '测试卡密商品',
        unitPrice: '10.00',
        quantity: 2,
      },
    ]);

    const first = markOrderPaidAndDeliverKeys('TESTKEY001', {
      status: 'TRADE_SUCCESS',
      trade_no: 'ALI-KEY-1',
    });
    assert.equal(first.assigned, 2);
    assert.equal(first.fulfillmentStatus, 'delivered');
    assert.equal(getKeysByOrderId(order.id).length, 2);
    assert.equal(countUnusedKeys(productId), 3);
    assert.equal(getProductById(productId)?.stock, 3);

    const second = markOrderPaidAndDeliverKeys('TESTKEY001', {
      status: 'TRADE_SUCCESS',
      trade_no: 'ALI-KEY-1',
    });
    assert.equal(second.assigned, 2);
    assert.equal(getKeysByOrderId(order.id).length, 2);
    assert.equal(countUnusedKeys(productId), 3);

    const view = getPublicOrderView('TESTKEY001');
    assert.ok(view);
    assert.equal(view!.paid, true);
    assert.equal(view!.keys.length, 2);
    assert.ok(view!.keys.every((k) => k.secret));

    const unpaid = getPublicOrderView(
      createOrder({
        outTradeNo: 'TESTUNPAID',
        subject: '未支付',
        totalAmount: '10.00',
        status: 'WAIT_BUYER_PAY',
      }).out_trade_no,
    );
    assert.equal(unpaid!.keys.length, 0);
    assert.equal(unpaid!.paid, false);
  });

  it('flags 待补发 when paid but keys are not enough (no silent under-sell without flag)', () => {
    const remain = countUnusedKeys(productId);
    const order = createOrder({
      outTradeNo: 'TESTSHORT001',
      subject: '超卖测试',
      totalAmount: '10.00',
      status: 'WAIT_BUYER_PAY',
    });
    addOrderItems(order.id, [
      {
        productId,
        productName: '测试卡密商品',
        unitPrice: '10.00',
        quantity: remain + 5,
      },
    ]);
    const result = markOrderPaidAndDeliverKeys('TESTSHORT001', {
      status: 'TRADE_SUCCESS',
    });
    assert.equal(result.fulfillmentStatus, 'pending_fulfillment');
    assert.equal(result.assigned, remain);
    assert.equal(countUnusedKeys(productId), 0);
    const view = getPublicOrderView('TESTSHORT001');
    assert.equal(view!.fulfillmentStatus, 'pending_fulfillment');
    assert.ok(view!.message);
    // 第二次通知不可再分配（已尝试发货）
    const again = markOrderPaidAndDeliverKeys('TESTSHORT001', {
      status: 'TRADE_SUCCESS',
    });
    assert.equal(again.fulfillmentStatus, 'pending_fulfillment');
    assert.equal(getKeysByOrderId(order.id).length, remain);
  });

  it('does not delete sold keys; unused can be deleted and stock syncs', () => {
    const p2 = createProduct({ name: '可删卡密', price: '1.00', status: 'on' });
    importCardKeys(p2.id, 'DEL-1\nDEL-2');
    const order = createOrder({
      outTradeNo: 'TESTDEL001',
      subject: p2.name,
      totalAmount: '1.00',
      status: 'WAIT_BUYER_PAY',
    });
    addOrderItems(order.id, [
      {
        productId: p2.id,
        productName: p2.name,
        unitPrice: '1.00',
        quantity: 1,
      },
    ]);
    markOrderPaidAndDeliverKeys('TESTDEL001', { status: 'TRADE_SUCCESS' });
    const keys = listProductKeys(p2.id, 'all');
    const sold = keys.find((k) => k.status === 'sold')!;
    const unused = keys.find((k) => k.status === 'unused')!;
    assert.equal(deleteUnusedKey(p2.id, sold.id), false);
    assert.equal(deleteUnusedKey(p2.id, unused.id), true);
    assert.equal(countUnusedKeys(p2.id), 0);
    assert.equal(getProductById(p2.id)?.stock, 0);
  });
});

describe('card secret encryption, reservation, 补发, public view', () => {
  it('stores secrets encrypted and lists them decrypted', () => {
    const p = createProduct({ name: '加密卡密商品', price: '1.00', status: 'on' });
    importCardKeys(p.id, 'ENC-PLAIN-KEY-1');
    const raw = getDb()
      .prepare(
        `SELECT secret, secret_hash FROM card_keys WHERE product_id = ? LIMIT 1`,
      )
      .get(p.id) as { secret: string; secret_hash: string };
    assert.equal(raw.secret.startsWith('enc:v1:'), true);
    assert.equal(raw.secret.includes('ENC-PLAIN-KEY-1'), false);
    assert.ok(raw.secret_hash);
    const listed = listProductKeys(p.id, 'unused');
    assert.equal(listed.length, 1);
    assert.equal(listed[0].secret, 'ENC-PLAIN-KEY-1');
  });

  it('reserves keys at checkout and rejects a concurrent oversell', () => {
    const p = createProduct({ name: '预占商品', price: '10.00', status: 'on' });
    importCardKeys(p.id, 'RSV-1\nRSV-2');
    assert.equal(countUnusedKeys(p.id), 2);

    const first = createReservedCheckoutOrder({
      outTradeNo: 'TESTRESERVE001',
      items: [{ productId: p.id, quantity: 2 }],
    });
    assert.equal(countUnusedKeys(p.id), 0);
    assert.equal(getProductById(p.id)?.stock, 0);
    const reserved = getKeysByOrderId(first.order.id);
    assert.equal(reserved.length, 2);
    assert.ok(reserved.every((k) => k.status === 'reserved'));

    assert.throws(
      () =>
        createReservedCheckoutOrder({
          outTradeNo: 'TESTRESERVE002',
          items: [{ productId: p.id, quantity: 2 }],
        }),
      (err: unknown) => err instanceof StockError && /卡密不足|库存不足/.test((err as Error).message),
    );

    const paid = markOrderPaidAndDeliverKeys('TESTRESERVE001', {
      status: 'TRADE_SUCCESS',
    });
    assert.equal(paid.assigned, 2);
    assert.equal(paid.fulfillmentStatus, 'delivered');
    assert.ok(getKeysByOrderId(first.order.id).every((k) => k.status === 'sold'));
  });

  it('releases reservations on failure and expired TTL, then syncs stock', () => {
    const p = createProduct({ name: '释放预占', price: '2.00', status: 'on' });
    importCardKeys(p.id, 'REL-1\nREL-2');
    const reserved = createReservedCheckoutOrder({
      outTradeNo: 'TESTRELEASE001',
      items: [{ productId: p.id, quantity: 2 }],
    });
    assert.equal(countUnusedKeys(p.id), 0);
    releaseReservationsForOrder(reserved.order.id);
    assert.equal(countUnusedKeys(p.id), 2);
    assert.equal(getProductById(p.id)?.stock, 2);

    const again = createReservedCheckoutOrder({
      outTradeNo: 'TESTRELEASE002',
      items: [{ productId: p.id, quantity: 1 }],
    });
    getDb()
      .prepare(
        `UPDATE card_keys SET reserved_until = datetime('now', '-1 minute')
         WHERE order_id = ?`,
      )
      .run(again.order.id);
    assert.equal(releaseExpiredReservations(), 0);
    assert.equal(countUnusedKeys(p.id), 1);

    getDb()
      .prepare(
        `UPDATE card_keys SET reserved_until = datetime('now', '-21 minutes')
         WHERE order_id = ?`,
      )
      .run(again.order.id);
    const n = releaseExpiredReservations();
    assert.ok(n >= 1);
    assert.equal(countUnusedKeys(p.id), 2);
  });

  it('still delivers this order reserved keys after reserved_until has passed', () => {
    const p = createProduct({ name: '迟到账预占', price: '2.00', status: 'on' });
    importCardKeys(p.id, 'LATE-KEY-1');
    const reserved = createReservedCheckoutOrder({
      outTradeNo: 'TESTLATEPAY001',
      items: [{ productId: p.id, quantity: 1 }],
    });
    getDb()
      .prepare(
        `UPDATE card_keys SET reserved_until = datetime('now', '-21 minutes')
         WHERE order_id = ?`,
      )
      .run(reserved.order.id);
    const paid = markOrderPaidAndDeliverKeys('TESTLATEPAY001', {
      status: 'TRADE_SUCCESS',
    });
    assert.equal(paid.assigned, 1);
    assert.equal(paid.fulfillmentStatus, 'delivered');
    const keys = getKeysByOrderId(reserved.order.id);
    assert.equal(keys.length, 1);
    assert.equal(keys[0].status, 'sold');
    assert.equal(keys[0].secret, 'LATE-KEY-1');
  });

  it('fulfills pending_fulfillment after restock without over-delivery', () => {
    const p = createProduct({ name: '补发商品', price: '3.00', status: 'on' });
    importCardKeys(p.id, 'FF-1');
    const order = createOrder({
      outTradeNo: 'TESTFULFILL001',
      subject: p.name,
      totalAmount: '9.00',
      status: 'WAIT_BUYER_PAY',
    });
    addOrderItems(order.id, [
      { productId: p.id, productName: p.name, unitPrice: '3.00', quantity: 3 },
    ]);
    const first = markOrderPaidAndDeliverKeys('TESTFULFILL001', {
      status: 'TRADE_SUCCESS',
    });
    assert.equal(first.fulfillmentStatus, 'pending_fulfillment');
    assert.equal(first.assigned, 1);

    const view = getPublicOrderView('TESTFULFILL001');
    assert.equal(view!.message, PENDING_FULFILLMENT_MESSAGE);
    assert.match(view!.message!, /自动发卡/);

    importCardKeys(p.id, 'FF-2\nFF-3\nFF-4');
    const afterImport = getPublicOrderView('TESTFULFILL001');
    assert.equal(afterImport!.fulfillmentStatus, 'delivered');
    assert.equal(afterImport!.keys.length, 3);
    assert.equal(countUnusedKeys(p.id), 1);

    const twice = fulfillPendingOrder('TESTFULFILL001');
    assert.equal(twice.added, 0);
    assert.equal(twice.assigned, 3);
    assert.equal(getKeysByOrderId(order.id).filter((k) => k.status === 'sold').length, 3);
  });

  it('keeps pending_fulfillment when restock is still short', () => {
    const p = createProduct({ name: '不足补货', price: '3.00', status: 'on' });
    importCardKeys(p.id, 'SHORT-1');
    const order = createOrder({
      outTradeNo: 'TESTSHORTSTOCK001',
      subject: p.name,
      totalAmount: '9.00',
      status: 'WAIT_BUYER_PAY',
    });
    addOrderItems(order.id, [
      { productId: p.id, productName: p.name, unitPrice: '3.00', quantity: 3 },
    ]);
    const first = markOrderPaidAndDeliverKeys('TESTSHORTSTOCK001', {
      status: 'TRADE_SUCCESS',
    });
    assert.equal(first.fulfillmentStatus, 'pending_fulfillment');
    assert.equal(first.assigned, 1);
    importCardKeys(p.id, 'SHORT-2');
    const mid = getPublicOrderView('TESTSHORTSTOCK001');
    assert.equal(mid!.fulfillmentStatus, 'pending_fulfillment');
    assert.equal(mid!.keys.length, 2);
    importCardKeys(p.id, 'SHORT-3');
    const done = getPublicOrderView('TESTSHORTSTOCK001');
    assert.equal(done!.fulfillmentStatus, 'delivered');
    assert.equal(done!.keys.length, 3);
  });

  it('public order view never includes notify payload or buyer account', () => {
    const p = createProduct({ name: '公开视图', price: '1.00', status: 'on' });
    importCardKeys(p.id, 'PUB-KEY-1');
    const order = createOrder({
      outTradeNo: 'TESTPUBLIC001',
      subject: p.name,
      totalAmount: '1.00',
      status: 'WAIT_BUYER_PAY',
    });
    addOrderItems(order.id, [
      { productId: p.id, productName: p.name, unitPrice: '1.00', quantity: 1 },
    ]);
    markOrderPaidAndDeliverKeys('TESTPUBLIC001', {
      status: 'TRADE_SUCCESS',
      trade_no: 'ALI-PUB',
      buyer_logon_id: 'buyer@example.com',
      raw_notify: JSON.stringify({
        buyer_logon_id: 'buyer@example.com',
        raw_secret_should_not_leak: 'SHOULD_NOT_APPEAR',
      }),
    });
    const view = getPublicOrderView('TESTPUBLIC001');
    assert.ok(view);
    const json = JSON.stringify(view);
    assert.equal('buyer_logon_id' in (view as object), false);
    assert.equal('raw_notify' in (view as object), false);
    assert.equal(json.includes('buyer@example.com'), false);
    assert.equal(json.includes('SHOULD_NOT_APPEAR'), false);
    assert.equal(json.includes('raw_notify'), false);
    assert.equal(view!.keys.length, 1);
  });
});
