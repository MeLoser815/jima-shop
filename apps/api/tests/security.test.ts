import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import bcrypt from 'bcryptjs';

import {
  assertProductionConfig,
  applyPersistedProductionSecrets,
  isPublicHttpsUrl,
  isInsecureSecret,
  shouldSeedSampleData,
  sanitizeCoverUrl,
  DEV_SESSION_SECRET_FALLBACK,
  DEV_ENCRYPTION_KEY_FALLBACK,
} from '../src/security.js';
import { fenToYuan, yuanToFen, addFen } from '../src/money.js';
import {
  matchNotifyToOrder,
  matchQueryToOrder,
} from '../src/paymentMatch.js';

const tmpDb = path.join(os.tmpdir(), `jima-sec-${Date.now()}.db`);
process.env.DATABASE_PATH = tmpDb;
process.env.SETTINGS_ENCRYPTION_KEY = 'test-encryption-key-32bytes!!!!';
process.env.SESSION_SECRET = 'test-session-secret';

const {
  allowAlipayQuery,
  resetAlipayQueryThrottleForTests,
  PUBLIC_TRADE_QUERY_INTERVAL_MS,
} = await import('../src/paymentSync.js');
const {
  getDb,
  createFirstAdminUser,
  AdminSetupError,
  updateAdminPassword,
  getAdminByUsername,
  revokeAdminSessionsForUser,
  revokeAdminSession,
} = await import('../src/db.js');
const { issueAdminAuth, authenticateAdminToken } = await import(
  '../src/middleware/auth.js'
);
const { createAdminToken, verifyAdminToken } = await import('../src/utils/crypto.js');
const { config } = await import('../src/config.js');

describe('money fen arithmetic', () => {
  it('converts yuan strings without floating error', () => {
    assert.equal(yuanToFen('69.90'), 6990);
    assert.equal(yuanToFen('0.01'), 1);
    assert.equal(yuanToFen('100'), 10000);
    assert.equal(fenToYuan(6990), '69.90');
    assert.equal(fenToYuan(addFen(yuanToFen('0.10'), yuanToFen('0.20'))), '0.30');
    assert.equal(fenToYuan(yuanToFen(0.1) + yuanToFen(0.2)), '0.30');
  });
});

describe('production config guards', () => {
  it('accepts public https notify URLs and rejects localhost/http/private', () => {
    assert.equal(isPublicHttpsUrl('https://pay.example.com/api/payment/notify'), true);
    assert.equal(isPublicHttpsUrl('http://example.com/api/payment/notify'), false);
    assert.equal(isPublicHttpsUrl('https://localhost/api/payment/notify'), false);
    assert.equal(isPublicHttpsUrl('https://127.0.0.1/api/payment/notify'), false);
    assert.equal(isPublicHttpsUrl('https://10.0.0.8/notify'), false);
    assert.equal(isPublicHttpsUrl('https://192.168.1.2/notify'), false);
    assert.equal(isInsecureSecret(DEV_SESSION_SECRET_FALLBACK), true);
    assert.equal(isInsecureSecret(DEV_ENCRYPTION_KEY_FALLBACK), true);
    assert.equal(isInsecureSecret(''), true);
    assert.equal(isInsecureSecret('a-sufficiently-long-random-secret'), false);
  });

  it('refuses placeholder secrets and invalid notify URLs, but allows a first start without notify', () => {
    assert.doesNotThrow(() =>
      assertProductionConfig({ NODE_ENV: 'development' }),
    );
    assert.throws(
      () =>
        assertProductionConfig({
          NODE_ENV: 'production',
          SESSION_SECRET: DEV_SESSION_SECRET_FALLBACK,
          SETTINGS_ENCRYPTION_KEY: 'real-encryption-key-not-placeholder!',
        }),
      /SESSION_SECRET/,
    );
    assert.throws(
      () =>
        assertProductionConfig({
          NODE_ENV: 'production',
          SESSION_SECRET: 'real-session-secret-not-placeholder!!',
          SETTINGS_ENCRYPTION_KEY: DEV_ENCRYPTION_KEY_FALLBACK,
        }),
      /SETTINGS_ENCRYPTION_KEY/,
    );
    assert.throws(
      () =>
        assertProductionConfig({
          NODE_ENV: 'production',
          SESSION_SECRET: 'real-session-secret-not-placeholder!!',
          SETTINGS_ENCRYPTION_KEY: 'real-encryption-key-not-placeholder!',
          ALIPAY_NOTIFY_URL: 'http://localhost:3001/api/payment/notify',
        }),
      /ALIPAY_NOTIFY_URL/,
    );
    assert.doesNotThrow(() =>
      assertProductionConfig({
        NODE_ENV: 'production',
        SESSION_SECRET: 'real-session-secret-not-placeholder!!',
        SETTINGS_ENCRYPTION_KEY: 'real-encryption-key-not-placeholder!',
      }),
    );
    assert.doesNotThrow(() =>
      assertProductionConfig({
        NODE_ENV: 'production',
        SESSION_SECRET: 'real-session-secret-not-placeholder!!',
        SETTINGS_ENCRYPTION_KEY: 'real-encryption-key-not-placeholder!',
        ALIPAY_NOTIFY_URL: 'https://shop.example.com/api/payment/notify',
      }),
    );
  });

  it('persists generated production secrets in the data directory', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jima-secrets-'));
    const env: NodeJS.ProcessEnv = { NODE_ENV: 'production' };
    applyPersistedProductionSecrets(dir, env);
    const firstSession = env.SESSION_SECRET;
    const firstKey = env.SETTINGS_ENCRYPTION_KEY;
    assert.ok(firstSession && firstSession.length >= 32);
    assert.ok(firstKey && firstKey.length >= 32);
    assert.equal(isInsecureSecret(firstSession), false);
    assert.equal(isInsecureSecret(firstKey), false);
    const env2: NodeJS.ProcessEnv = { NODE_ENV: 'production' };
    applyPersistedProductionSecrets(dir, env2);
    assert.equal(env2.SESSION_SECRET, firstSession);
    assert.equal(env2.SETTINGS_ENCRYPTION_KEY, firstKey);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('never seeds demo catalog in production', () => {
    assert.equal(shouldSeedSampleData({ NODE_ENV: 'production' }), false);
    assert.equal(shouldSeedSampleData({ NODE_ENV: 'development' }), true);
    assert.equal(
      shouldSeedSampleData({ NODE_ENV: 'development', JIMA_SEED_DEMO: '0' }),
      false,
    );
  });
});

describe('cover url hygiene', () => {
  it('allows http(s) and safe relative paths only', () => {
    assert.equal(
      sanitizeCoverUrl('https://images.example.com/a.png'),
      'https://images.example.com/a.png',
    );
    assert.equal(sanitizeCoverUrl('/covers/a.png'), '/covers/a.png');
    assert.throws(() => sanitizeCoverUrl('javascript:alert(1)'));
    assert.throws(() => sanitizeCoverUrl('data:text/html,hi'));
    assert.throws(() => sanitizeCoverUrl('//evil.example/x'));
    assert.throws(() => sanitizeCoverUrl('/covers/../etc/passwd'));
  });
});

describe('notify / query amount and app_id checks', () => {
  const order = { total_amount: '69.90' };
  const configured = { appId: 'APP123', sellerId: 'SELLER9' };

  it('accepts an exact match including fen-equal amounts', () => {
    const ok = matchNotifyToOrder(
      order,
      { totalAmount: '69.90', appId: 'APP123', sellerId: 'SELLER9' },
      configured,
    );
    assert.equal(ok.ok, true);
    const fenEq = matchNotifyToOrder(
      order,
      { totalAmount: '69.9', appId: 'APP123' },
      configured,
    );
    assert.equal(fenEq.ok, true);
  });

  it('fails closed on amount or app_id mismatch / missing', () => {
    assert.equal(
      matchNotifyToOrder(
        order,
        { totalAmount: '1.00', appId: 'APP123' },
        configured,
      ).ok,
      false,
    );
    assert.equal(
      matchNotifyToOrder(
        order,
        { totalAmount: '69.90', appId: 'OTHER' },
        configured,
      ).ok,
      false,
    );
    assert.equal(
      matchNotifyToOrder(order, { totalAmount: '69.90' }, configured).ok,
      false,
    );
    const seller = matchNotifyToOrder(
      order,
      { totalAmount: '69.90', appId: 'APP123', sellerId: 'OTHER' },
      configured,
    );
    assert.equal(seller.ok, false);
    if (!seller.ok) assert.equal(seller.reason, 'seller_id_mismatch');
  });

  it('query only requires amount; app_id compared when present', () => {
    const ok = matchQueryToOrder(
      order,
      { totalAmount: '69.90' },
      configured,
    );
    assert.equal(ok.ok, true);
    const badApp = matchQueryToOrder(
      order,
      { totalAmount: '69.90', appId: 'OTHER' },
      configured,
    );
    assert.equal(badApp.ok, false);
  });
});

describe('public Alipay query throttle', () => {
  it('rate-limits repeated tradeQuery per order', () => {
    resetAlipayQueryThrottleForTests();
    assert.equal(allowAlipayQuery('NO1', 1000, 1_000), true);
    assert.equal(allowAlipayQuery('NO1', 1000, 1_500), false);
    assert.equal(allowAlipayQuery('NO1', 1000, 2_000), true);
    assert.equal(allowAlipayQuery('NO2', 1000, 2_000), true);
    assert.ok(PUBLIC_TRADE_QUERY_INTERVAL_MS >= 5000);
  });
});

describe('admin session issue / revoke', () => {
  before(() => {
    getDb();
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

  it('rejects a two-username first-admin race', async () => {
    const hash = await bcrypt.hash('password-one-xx', 12);
    const first = createFirstAdminUser('alice', hash);
    assert.equal(first.username, 'alice');
    await assert.rejects(
      async () => {
        const hash2 = await bcrypt.hash('password-two-xx', 12);
        createFirstAdminUser('bob', hash2);
      },
      AdminSetupError,
    );
  });

  it('password change and logout revoke existing tokens', async () => {
    const userName = 'alice';
    const user = getAdminByUsername(userName)!;
    const { token } = issueAdminAuth(user.username, user.password_version);
    assert.ok(authenticateAdminToken(token));

    const { token: token2 } = issueAdminAuth(user.username, user.password_version);
    assert.ok(authenticateAdminToken(token2));

    const newHash = await bcrypt.hash('password-changed-ok', 12);
    updateAdminPassword(userName, newHash);
    revokeAdminSessionsForUser(userName);

    assert.equal(authenticateAdminToken(token), null);
    assert.equal(authenticateAdminToken(token2), null);

    const fresh = getAdminByUsername(userName)!;
    const issued = issueAdminAuth(fresh.username, fresh.password_version);
    assert.ok(authenticateAdminToken(issued.token));

    revokeAdminSession(issued.jti);
    assert.equal(authenticateAdminToken(issued.token), null);
  });

  it('rejects legacy username-only tokens', () => {
    // 旧格式只有 ts.username.sig，不能当有效登录
    const legacyLike = createAdminToken(config.sessionSecret, 'alice', 'x', 1);
    const ok = verifyAdminToken(legacyLike, config.sessionSecret);
    assert.equal(ok.ok, true); // new format still works
    const raw = Buffer.from('1000.alice.deadbeefsig', 'utf8').toString('base64url');
    assert.equal(verifyAdminToken(raw, config.sessionSecret).ok, false);
  });
});
