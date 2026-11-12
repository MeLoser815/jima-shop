import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

const tmpDb = path.join(os.tmpdir(), `jima-checkout-access-${Date.now()}.db`);
process.env.DATABASE_PATH = tmpDb;
process.env.SETTINGS_ENCRYPTION_KEY = 'test-encryption-key-32bytes!!!!';
process.env.SESSION_SECRET = 'test-session-secret';

const {
  buildAutoNotifyUrl,
  isInsecurePublicHttp,
  isLocalHostname,
  requestAccessFromRequest,
  INSECURE_HTTP_PAY_HINT,
} = await import('../src/security.js');
const {
  inspectAlipaySettings,
  getDb,
  saveAlipaySettings,
} = await import('../src/db.js');
const {
  parseResult,
  precreateFailureMessage,
  qrCodeFromResult,
  resolveNotifyUrl,
  validateAlipayConfig,
} = await import('../src/alipay.js');

describe('HTTP vs HTTPS checkout access', () => {
  it('does not auto-build a notify URL over HTTP', () => {
    assert.equal(buildAutoNotifyUrl('http', 'pay.gdnb666.top'), undefined);
    assert.equal(
      buildAutoNotifyUrl('https', 'pay.gdnb666.top'),
      'https://pay.gdnb666.top/api/payment/notify',
    );
    assert.equal(isInsecurePublicHttp('http', 'pay.gdnb666.top'), true);
    assert.equal(isInsecurePublicHttp('https', 'pay.gdnb666.top'), false);
    assert.equal(isInsecurePublicHttp('http', 'localhost:8001'), false);
    assert.equal(isLocalHostname('127.0.0.1:8001'), true);
    assert.match(INSECURE_HTTP_PAY_HINT, /HTTPS/);
  });

  it('reads https from forwarded proto when the app itself sees http', () => {
    const viaProxy = requestAccessFromRequest({
      protocol: 'http',
      hostname: '127.0.0.1',
      headers: {
        host: '127.0.0.1:8001',
        'x-forwarded-proto': 'https',
        'x-forwarded-host': 'pay.gdnb666.top',
      },
    });
    assert.equal(viaProxy.notifyUrl, 'https://pay.gdnb666.top/api/payment/notify');
    assert.equal(viaProxy.insecureHttp, false);

    const plainHttp = requestAccessFromRequest({
      protocol: 'http',
      hostname: 'pay.gdnb666.top',
      headers: { host: 'pay.gdnb666.top' },
    });
    assert.equal(plainHttp.notifyUrl, undefined);
    assert.equal(plainHttp.insecureHttp, true);
  });

  it('omits notifyUrl when it cannot be built, so HTTP can still precreate', () => {
    const notifyUrl = resolveNotifyUrl('', undefined);
    const params = notifyUrl ? { notifyUrl } : {};
    assert.deepEqual(params, {});
    assert.equal('notifyUrl' in params, false);
  });
});

describe('precreate result and error copy', () => {
  it('extracts qrCode from camelCase, snake_case, and nested responses', () => {
    assert.equal(
      qrCodeFromResult(
        parseResult({ code: '10000', msg: 'Success', qrCode: 'https://qr.alipay.com/a' }),
      ),
      'https://qr.alipay.com/a',
    );
    assert.equal(
      qrCodeFromResult(
        parseResult({ code: '10000', msg: 'Success', qr_code: 'https://qr.alipay.com/b' }),
      ),
      'https://qr.alipay.com/b',
    );
    assert.equal(
      qrCodeFromResult(
        parseResult({
          alipay_trade_precreate_response: {
            code: '10000',
            msg: 'Success',
            qr_code: 'https://qr.alipay.com/c',
          },
        }),
      ),
      'https://qr.alipay.com/c',
    );
    assert.equal(
      qrCodeFromResult(parseResult({ code: '10000', msg: 'Success' })),
      undefined,
    );
  });

  it('explains HTTP / invalid notify_url failures in Chinese', () => {
    assert.match(
      precreateFailureMessage(
        { ok: false, msg: 'notify_url is invalid', raw: {} },
        { insecureHttp: true },
      ),
      /HTTPS/,
    );
    assert.match(
      precreateFailureMessage({
        ok: false,
        subCode: 'isv.invalid-notify-url',
        subMsg: '通知地址不合法',
        raw: {},
      }),
      /HTTPS/,
    );
    const other = precreateFailureMessage(
      { ok: false, subMsg: '无效的AppID参数', raw: {} },
      { insecureHttp: true },
    );
    assert.match(other, /无效的AppID/);
    assert.match(other, /HTTPS/);
  });
});

describe('alipay settings inspect and dry validation', () => {
  before(() => {
    getDb();
  });

  after(() => {
    for (const suffix of ['', '-wal', '-shm']) {
      try {
        fs.unlinkSync(tmpDb + suffix);
      } catch {
        /* ignore */
      }
    }
  });

  it('treats undecryptable stored keys as unreadable, not configured', () => {
    saveAlipaySettings({
      appId: '2021000000000000',
      privateKey: 'A'.repeat(64),
      alipayPublicKey: 'B'.repeat(64),
    });
    assert.equal(inspectAlipaySettings().configured, true);
    getDb()
      .prepare(`UPDATE settings SET value = 'not-valid-cipher' WHERE key = 'private_key_enc'`)
      .run();
    const info = inspectAlipaySettings();
    assert.equal(info.configured, false);
    assert.equal(info.unreadable, true);
    assert.equal(info.appId, '2021000000000000');
  });

  it('validates key format locally without calling Alipay', () => {
    const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const privateKey = pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const alipayPublicKey = pair.publicKey.export({ type: 'spki', format: 'pem' }).toString();
    const ok = validateAlipayConfig({
      appId: '2021000000000000',
      privateKey,
      alipayPublicKey,
      gateway: 'https://openapi.alipay.com/gateway.do',
      storeId: '',
      notifyUrl: '',
      sellerId: '',
    });
    assert.equal(ok.ok, true);

    const bad = validateAlipayConfig({
      appId: 'not-an-app-id',
      privateKey,
      alipayPublicKey,
      gateway: 'https://openapi.alipay.com/gateway.do',
      storeId: '',
      notifyUrl: '',
      sellerId: '',
    });
    assert.equal(bad.ok, false);
    assert.match(bad.error || '', /AppId/);
  });
});
