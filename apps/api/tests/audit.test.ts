import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

const tmpDb = path.join(os.tmpdir(), `jima-audit-${Date.now()}.db`);
process.env.DATABASE_PATH = tmpDb;
process.env.SETTINGS_ENCRYPTION_KEY = 'test-encryption-key-32bytes!!!!';
process.env.SESSION_SECRET = 'test-session-secret';

const { getDb } = await import('../src/db.js');
const {
  logAudit,
  listAuditLogs,
  purgeExpiredAuditLogs,
  setAuditLogRetentionDays,
  getAuditLogRetentionDays,
  normalizeAuditPageSize,
} = await import('../src/audit.js');

describe('audit log pagination and retention', () => {
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
    assert.equal(normalizeAuditPageSize(15), 15);
    assert.equal(normalizeAuditPageSize(30), 30);
    assert.equal(normalizeAuditPageSize(7), 15);
    assert.equal(normalizeAuditPageSize('100'), 100);
  });

  it('pages 15 items by default and reports total', () => {
    getDb();
    for (let i = 0; i < 40; i += 1) {
      logAudit({ actor: 'admin', action: 'admin.login', detail: { i } });
    }
    const first = listAuditLogs(1, 15);
    assert.equal(first.pageSize, 15);
    assert.equal(first.logs.length, 15);
    assert.equal(first.total, 40);
    const third = listAuditLogs(3, 15);
    assert.equal(third.logs.length, 10);
    assert.notEqual(first.logs[0].id, third.logs[0].id);
  });

  it('stores retention days and purges expired rows', () => {
    assert.equal(getAuditLogRetentionDays(), 30);
    assert.equal(setAuditLogRetentionDays(7), 7);
    assert.equal(getAuditLogRetentionDays(), 7);
    assert.throws(() => setAuditLogRetentionDays(3));

    getDb()
      .prepare(
        `INSERT INTO audit_logs(actor, action, detail, ip, created_at)
         VALUES('admin', 'admin.login', null, null, '2020-01-01 00:00:00')`,
      )
      .run();
    const removed = purgeExpiredAuditLogs(7);
    assert.ok(removed >= 1);
    const left = listAuditLogs(1, 100);
    assert.equal(
      left.logs.some((r) => r.created_at.startsWith('2020-01-01')),
      false,
    );
  });

  it('filters audit logs by action and keyword', () => {
    logAudit({ actor: 'shop-owner', action: 'order.fulfill', detail: { outTradeNo: 'JM-FILTER-1' } });
    const byAction = listAuditLogs(1, 15, { action: 'order.fulfill' });
    assert.ok(byAction.total >= 1);
    assert.ok(byAction.logs.every((r) => r.action === 'order.fulfill'));
    const byText = listAuditLogs(1, 15, { q: 'JM-FILTER-1' });
    assert.equal(byText.total, 1);
    assert.equal(byText.logs[0].action, 'order.fulfill');
  });
});
