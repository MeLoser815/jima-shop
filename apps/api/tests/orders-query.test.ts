import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

const tmpDb = path.join(os.tmpdir(), `jima-orders-query-${Date.now()}.db`);
process.env.DATABASE_PATH = tmpDb;
process.env.SETTINGS_ENCRYPTION_KEY = 'test-encryption-key-32bytes!!!!';
process.env.SESSION_SECRET = 'test-session-secret';

const {
  getDb,
  createOrder,
  updateOrder,
  queryAdminOrders,
  getDashboardStats,
  normalizeAdminListPageSize,
} = await import('../src/db.js');

describe('admin order query', () => {
  before(() => {
    getDb();
    createOrder({
      outTradeNo: 'JM-PAID-1',
      subject: '草莓卡密',
      totalAmount: '19.90',
      status: 'TRADE_SUCCESS',
    });
    updateOrder('JM-PAID-1', {
      trade_no: 'ALI-PAID-1',
      fulfillment_status: 'delivered',
    });
    createOrder({
      outTradeNo: 'JM-WAIT-2',
      subject: '当面收款',
      totalAmount: '8.00',
      status: 'WAIT_BUYER_PAY',
      buyerNote: '不要包装',
    });
    createOrder({
      outTradeNo: 'JM-GAP-3',
      subject: '补发卡密订单',
      totalAmount: '39.00',
      status: 'TRADE_SUCCESS',
    });
    updateOrder('JM-GAP-3', { fulfillment_status: 'pending_fulfillment' });
    createOrder({
      outTradeNo: 'JM-FAIL-4',
      subject: '失败订单',
      totalAmount: '1.00',
      status: 'FAILED',
    });
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

  it('normalizes page size to 15, 30, 50 or 100', () => {
    assert.equal(normalizeAdminListPageSize(15), 15);
    assert.equal(normalizeAdminListPageSize(50), 50);
    assert.equal(normalizeAdminListPageSize(7), 15);
    assert.equal(normalizeAdminListPageSize('100'), 100);
  });

  it('filters by payment status, fulfillment and keyword', () => {
    const paid = queryAdminOrders({ payStatus: 'paid', pageSize: 15 });
    assert.equal(paid.total, 2);
    assert.ok(paid.orders.every((o) => o.status === 'TRADE_SUCCESS'));

    const pending = queryAdminOrders({
      fulfillment: 'pending_fulfillment',
      pageSize: 15,
    });
    assert.equal(pending.total, 1);
    assert.equal(pending.orders[0].out_trade_no, 'JM-GAP-3');

    const byNo = queryAdminOrders({ q: 'JM-WAIT', pageSize: 15 });
    assert.equal(byNo.total, 1);
    assert.equal(byNo.orders[0].out_trade_no, 'JM-WAIT-2');

    const byNote = queryAdminOrders({ q: '包装', pageSize: 15 });
    assert.equal(byNote.total, 1);

    const closed = queryAdminOrders({ payStatus: 'closed', pageSize: 15 });
    assert.equal(closed.total, 1);
    assert.equal(closed.orders[0].status, 'FAILED');
  });

  it('sorts by amount and paginates', () => {
    const desc = queryAdminOrders({
      sortBy: 'total_amount',
      sortOrder: 'desc',
      page: 1,
      pageSize: 15,
    });
    assert.equal(desc.total, 4);
    assert.equal(desc.orders[0].out_trade_no, 'JM-GAP-3');

    const page1 = queryAdminOrders({
      sortBy: 'total_amount',
      sortOrder: 'asc',
      page: 1,
      pageSize: 15,
    });
    // 15 is the smallest allowed page size; still returns all 4 here
    assert.equal(page1.orders[0].out_trade_no, 'JM-FAIL-4');

    const first = queryAdminOrders({ page: 1, pageSize: 15, sortBy: 'id', sortOrder: 'desc' });
    assert.equal(first.pageSize, 15);
    assert.equal(first.orders.length, 4);
  });

  it('counts pending fulfillment on the dashboard', () => {
    const stats = getDashboardStats();
    assert.equal(stats.pendingFulfillmentCount, 1);
    assert.equal(stats.paidCount, 2);
  });
});
