import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

const tmpDb = path.join(os.tmpdir(), `jima-test-${Date.now()}.db`);
process.env.DATABASE_PATH = tmpDb;
process.env.SETTINGS_ENCRYPTION_KEY = 'test-encryption-key-32bytes!!!!';
process.env.SESSION_SECRET = 'test-session-secret';

const {
  getDb,
  listProducts,
  createProduct,
  updateProduct,
  deleteProduct,
  getProductById,
  createOrder,
  addOrderItems,
  getOrderItems,
  ProductDeleteError,
} = await import('../src/db.js');
const {
  importCardKeys,
  markOrderPaidAndDeliverKeys,
  getKeysByOrderId,
  countUnusedKeys,
} = await import('../src/cardKeys.js');

describe('products & orders', () => {
  before(() => {
    getDb();
  });

  after(() => {
    try {
      fs.unlinkSync(tmpDb);
      fs.unlinkSync(tmpDb + '-wal');
      fs.unlinkSync(tmpDb + '-shm');
    } catch {
      /* ignore */
    }
  });

  it('seeds sample products', () => {
    const all = listProducts({ status: 'all' });
    assert.ok(all.length >= 6);
  });

  it('CRUD product (stock is derived from unused keys)', () => {
    const p = createProduct({
      name: '测试小物',
      price: '9.90',
      stock: 5,
      status: 'on',
    });
    assert.equal(p.name, '测试小物');
    assert.equal(p.stock, 0);
    const ignored = updateProduct(p.id, { stock: 3, status: 'off' });
    assert.equal(ignored?.stock, 0);
    assert.equal(ignored?.status, 'off');
    assert.equal(deleteProduct(p.id), true);
    assert.equal(getProductById(p.id), null);
  });

  it('assigns card keys on paid and keeps stock in sync', () => {
    const p = createProduct({
      name: '库存商品',
      price: '10.00',
      status: 'on',
    });
    importCardKeys(
      p.id,
      Array.from({ length: 10 }, (_, i) => `KEY-${i + 1}`).join('\n'),
    );
    assert.equal(getProductById(p.id)?.stock, 10);
    const order = createOrder({
      outTradeNo: 'TESTSTOCK001',
      subject: p.name,
      totalAmount: '20.00',
      status: 'WAIT_BUYER_PAY',
    });
    addOrderItems(order.id, [
      {
        productId: p.id,
        productName: p.name,
        unitPrice: '10.00',
        quantity: 2,
      },
    ]);
    markOrderPaidAndDeliverKeys('TESTSTOCK001', {
      status: 'TRADE_SUCCESS',
      trade_no: 'ALI123',
    });
    assert.equal(getProductById(p.id)?.stock, 8);
    assert.equal(countUnusedKeys(p.id), 8);
    assert.equal(getKeysByOrderId(order.id).length, 2);
    // idempotent
    markOrderPaidAndDeliverKeys('TESTSTOCK001', { status: 'TRADE_SUCCESS' });
    assert.equal(getProductById(p.id)?.stock, 8);
    assert.equal(getKeysByOrderId(order.id).length, 2);
    assert.equal(getOrderItems(order.id).length, 1);

    assert.throws(() => deleteProduct(p.id), ProductDeleteError);
    assert.ok(getProductById(p.id));
  });
});
