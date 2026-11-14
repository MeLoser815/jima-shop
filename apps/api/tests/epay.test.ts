import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

const tmpDb = path.join(os.tmpdir(), `jima-epay-${Date.now()}.db`);
process.env.DATABASE_PATH = tmpDb;
process.env.SETTINGS_ENCRYPTION_KEY = 'test-encryption-key-32bytes!!!!';
process.env.SESSION_SECRET = 'test-session-secret';

const {
  signEpayParams,
  verifyEpaySign,
  buildEpayCreateParams,
  collectEpayParams,
  parseEpayQueryResult,
  parseEpayCreateResult,
  qrOrPayContent,
  isSafeEpayGatewayUrl,
  normalizeEpayGateway,
  buyerReturnUrl,
  validateEpayConfig,
} = await import('../src/epay.js');
const { isPublicHttpUrl, isBlockedSsrfHost, buildAutoEpayNotifyUrl } =
  await import('../src/security.js');
const {
  listAvailablePaymentMethods,
  paymentChannelLabel,
  normalizeEpayChannels,
} = await import('../src/paymentMethods.js');
const {
  getDb,
  createProduct,
  saveEpaySettings,
  loadEpaySettings,
  inspectEpaySettings,
  epayConfigured,
  paymentConfigured,
  settingsConfigured,
  createOrder,
  getOrderByOutTradeNo,
} = await import('../src/db.js');
const {
  importCardKeys,
  createReservedCheckoutOrder,
  getPublicOrderView,
  countUnusedKeys,
} = await import('../src/cardKeys.js');
const { applyVerifiedTrade } = await import('../src/paymentSync.js');

const TEST_KEY = 'test-merchant-key';

describe('epay sign and notify verification', () => {
  it('signs params with ASCII-sorted keys, excluding sign, sign_type and empty values', () => {
    const params = {
      pid: '1001',
      type: 'wxpay',
      out_trade_no: 'JM001',
      name: '测试商品',
      money: '1.00',
      notify_url: 'https://shop.example.com/api/payment/epay/notify',
      return_url: '',
      unused: undefined,
      sign_type: 'MD5',
    };
    const sign = signEpayParams(params, TEST_KEY);
    const expectedSeed =
      'money=1.00&name=测试商品&notify_url=https://shop.example.com/api/payment/epay/notify&out_trade_no=JM001&pid=1001&type=wxpay' +
      TEST_KEY;
    const expected = createHash('md5').update(expectedSeed, 'utf8').digest('hex');
    assert.equal(sign, expected);
    assert.equal(sign, sign.toLowerCase());
    assert.ok(!expectedSeed.includes('sign_type'));
    assert.ok(!expectedSeed.includes('undefined'));
    assert.ok(!expectedSeed.includes('return_url'));
  });

  it('verifies a genuine notify and rejects a tampered one', () => {
    const base = {
      pid: '1001',
      trade_no: 'E123',
      out_trade_no: 'JM001',
      type: 'wxpay',
      name: '测试商品',
      money: '1.00',
      trade_status: 'TRADE_SUCCESS',
    };
    const params = { ...base, sign: signEpayParams(base, TEST_KEY), sign_type: 'MD5' };
    assert.equal(verifyEpaySign(params, TEST_KEY), true);
    assert.equal(verifyEpaySign({ ...params, money: '2.00' }, TEST_KEY), false);
    assert.equal(verifyEpaySign({ ...params, sign: 'deadbeef' }, TEST_KEY), false);
    assert.equal(verifyEpaySign({ ...base, sign: '' }, TEST_KEY), false);
  });

  it('omits notify_url from create params and sign when HTTP access cannot auto-build it', () => {
    const params = buildEpayCreateParams({
      pid: '1001',
      type: 'alipay',
      outTradeNo: 'JM002',
      name: '商品',
      money: '9.90',
      clientIp: '203.0.113.10',
      device: 'pc',
      notifyUrl: undefined,
      returnUrl: 'http://shop.example.com/order?no=JM002',
      key: TEST_KEY,
    });
    assert.equal('notify_url' in params, false);
    assert.equal(params.return_url, 'http://shop.example.com/order?no=JM002');
    assert.equal(params.sign_type, 'MD5');
    assert.ok(params.sign);
    const seedKeys = Object.keys(params).filter((k) => k !== 'sign' && k !== 'sign_type');
    assert.ok(!seedKeys.includes('notify_url'));
    assert.equal(verifyEpaySign(params, TEST_KEY), true);
    assert.equal(JSON.stringify(params).includes('undefined'), false);
  });

  it('includes notify_url when a public HTTPS callback is available', () => {
    const notify = 'https://shop.example.com/api/payment/epay/notify';
    assert.equal(
      buildAutoEpayNotifyUrl('https', 'shop.example.com'),
      notify,
    );
    assert.equal(buildAutoEpayNotifyUrl('http', 'shop.example.com'), undefined);
    const params = buildEpayCreateParams({
      pid: '1001',
      type: 'alipay',
      outTradeNo: 'JM003',
      name: '商品',
      money: '9.90',
      notifyUrl: notify,
      key: TEST_KEY,
    });
    assert.equal(params.notify_url, notify);
    assert.equal(verifyEpaySign(params, TEST_KEY), true);
  });

  it('collects query/body params without copying undefined', () => {
    const params = collectEpayParams({
      pid: '1001',
      money: '1.00',
      empty: '',
      missing: undefined,
      list: ['a'],
    });
    assert.deepEqual(params, { pid: '1001', money: '1.00', empty: '', list: 'a' });
    assert.equal('missing' in params, false);
  });

  it('parses create and query responses, treating status=1 as paid', () => {
    const created = parseEpayCreateResult({
      code: 1,
      trade_no: 'E1',
      payurl: 'https://pay.example.com/pay/1',
    });
    assert.equal(created.ok, true);
    assert.equal(created.payUrl, 'https://pay.example.com/pay/1');
    assert.equal(qrOrPayContent(created), 'https://pay.example.com/pay/1');

    const withQr = parseEpayCreateResult({
      code: '1',
      qrcode: 'https://qr.example.com/x',
      payurl: 'https://pay.example.com/pay/2',
    });
    assert.equal(qrOrPayContent(withQr), 'https://qr.example.com/x');

    const paid = parseEpayQueryResult({
      code: 1,
      status: 1,
      money: '1.00',
      pid: '1001',
      trade_no: 'E1',
      out_trade_no: 'JM001',
    });
    assert.equal(paid.ok, true);
    assert.equal(paid.tradeStatus, 'TRADE_SUCCESS');
    assert.equal(paid.money, '1.00');

    const unpaid = parseEpayQueryResult({
      code: '1',
      status: '0',
      money: '1.00',
    });
    assert.equal(unpaid.tradeStatus, 'WAIT_BUYER_PAY');
  });
});

describe('epay gateway SSRF guard', () => {
  it('accepts public http(s) gateways and rejects private, local, file and metadata targets', () => {
    assert.equal(isSafeEpayGatewayUrl('https://pay.example.com/'), true);
    assert.equal(isSafeEpayGatewayUrl('http://pay.example.com/api/'), true);
    assert.equal(isSafeEpayGatewayUrl('https://pay.example.com/mapi.php'), true);
    assert.equal(normalizeEpayGateway('https://pay.example.com/mapi.php'), 'https://pay.example.com/');

    assert.equal(isSafeEpayGatewayUrl('https://localhost/pay'), false);
    assert.equal(isSafeEpayGatewayUrl('http://127.0.0.1/'), false);
    assert.equal(isSafeEpayGatewayUrl('http://10.0.0.8/mapi.php'), false);
    assert.equal(isSafeEpayGatewayUrl('http://192.168.1.2/'), false);
    assert.equal(isSafeEpayGatewayUrl('http://172.16.0.1/'), false);
    assert.equal(isSafeEpayGatewayUrl('http://169.254.169.254/latest/meta-data'), false);
    assert.equal(isSafeEpayGatewayUrl('file:///etc/passwd'), false);
    assert.equal(isSafeEpayGatewayUrl('http://metadata.google.internal/'), false);
    assert.equal(isPublicHttpUrl('https://shop.example.com/ok'), true);
    assert.equal(isPublicHttpUrl('http://192.168.0.5/'), false);
    assert.equal(isBlockedSsrfHost('169.254.169.254'), true);
    assert.equal(isBlockedSsrfHost('::1'), true);
    assert.equal(buyerReturnUrl('https://shop.example.com', 'JM1'), 'https://shop.example.com/order?no=JM1');
  });
});

describe('available buyer payment methods', () => {
  it('exposes only buyer-facing labels and hides epay alipay when official Alipay is already on', () => {
    assert.deepEqual(
      listAvailablePaymentMethods({
        alipayConfigured: true,
        epayConfigured: false,
        epayChannels: [],
      }),
      [{ id: 'alipay_f2f', label: '支付宝' }],
    );
    assert.deepEqual(
      listAvailablePaymentMethods({
        alipayConfigured: false,
        epayConfigured: true,
        epayChannels: ['wxpay', 'alipay', 'qqpay'],
      }),
      [
        { id: 'epay_alipay', label: '支付宝' },
        { id: 'epay_wxpay', label: '微信' },
        { id: 'epay_qqpay', label: 'QQ钱包' },
      ],
    );
    const both = listAvailablePaymentMethods({
      alipayConfigured: true,
      epayConfigured: true,
      epayChannels: ['alipay', 'wxpay'],
    });
    assert.deepEqual(both, [
      { id: 'alipay_f2f', label: '支付宝' },
      { id: 'epay_wxpay', label: '微信' },
    ]);
    assert.ok(both.every((m) => !/易支付|pid|网关/i.test(m.label)));
    assert.equal(paymentChannelLabel('epay_wxpay'), '微信');
    assert.equal(paymentChannelLabel('alipay_f2f'), '支付宝');
    assert.deepEqual(normalizeEpayChannels(['wxpay', 'nope', 'wxpay', 'alipay']), [
      'wxpay',
      'alipay',
    ]);
  });
});

describe('epay settings, notify fulfillment', () => {
  let productId: number;

  before(() => {
    getDb();
    const p = createProduct({
      name: '易支付测试商品',
      price: '1.00',
      status: 'on',
    });
    productId = p.id;
    importCardKeys(productId, 'EPAY-KEY-001\nEPAY-KEY-002');
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

  it('saves optional epay settings without echoing the key, and does not require official Alipay', () => {
    assert.equal(settingsConfigured(), false);
    assert.equal(epayConfigured(), false);
    assert.equal(paymentConfigured(), false);
    saveEpaySettings({
      enabled: true,
      gateway: 'https://pay.example.com/',
      pid: '1001',
      key: TEST_KEY,
      channels: ['wxpay', 'alipay'],
    });
    const loaded = loadEpaySettings();
    assert.ok(loaded);
    assert.equal(loaded!.enabled, true);
    assert.equal(loaded!.pid, '1001');
    assert.equal(loaded!.key, TEST_KEY);
    assert.deepEqual(loaded!.channels, ['wxpay', 'alipay']);
    assert.equal(epayConfigured(), true);
    assert.equal(paymentConfigured(), true);
    assert.equal(settingsConfigured(), false);
    const info = inspectEpaySettings();
    assert.equal(info.configured, true);
    assert.equal(info.unreadable, false);
    const check = validateEpayConfig(loaded);
    assert.equal(check.ok, true);

    const badGw = validateEpayConfig({
      ...loaded!,
      gateway: 'http://127.0.0.1:8080/',
    });
    assert.equal(badGw.ok, false);
    assert.match(badGw.error || '', /网关/);
  });

  it('delivers reserved card keys after a signed TRADE_SUCCESS notify, and rejects amount mismatch', () => {
    const reserved = createReservedCheckoutOrder({
      outTradeNo: 'JMEPAYOK001',
      paymentChannel: 'epay_wxpay',
      items: [{ productId, quantity: 1 }],
    });
    assert.equal(reserved.order.payment_channel, 'epay_wxpay');
    assert.equal(countUnusedKeys(productId), 1);

    const mismatch = applyVerifiedTrade({
      outTradeNo: 'JMEPAYOK001',
      tradeStatus: 'TRADE_SUCCESS',
      tradeNo: 'E-MISMATCH',
      identity: { totalAmount: '9.99', pid: '1001' },
      source: 'notify',
      provider: 'epay',
    });
    assert.equal(mismatch.ok, false);
    assert.equal(mismatch.ok ? '' : mismatch.reason, 'amount_mismatch');
    assert.equal(getOrderByOutTradeNo('JMEPAYOK001')?.status, 'WAIT_BUYER_PAY');

    const badPid = applyVerifiedTrade({
      outTradeNo: 'JMEPAYOK001',
      tradeStatus: 'TRADE_SUCCESS',
      tradeNo: 'E-PID',
      identity: { totalAmount: '1.00', pid: '9999' },
      source: 'notify',
      provider: 'epay',
    });
    assert.equal(badPid.ok, false);

    const applied = applyVerifiedTrade({
      outTradeNo: 'JMEPAYOK001',
      tradeStatus: 'TRADE_SUCCESS',
      tradeNo: 'E-OK-1',
      identity: { totalAmount: '1.00', pid: '1001' },
      rawNotify: JSON.stringify({ trade_status: 'TRADE_SUCCESS' }),
      source: 'notify',
      provider: 'epay',
    });
    assert.equal(applied.ok, true);
    const view = getPublicOrderView('JMEPAYOK001');
    assert.ok(view);
    assert.equal(view!.paid, true);
    assert.equal(view!.keys.length, 1);
    assert.equal(view!.keys[0].secret, 'EPAY-KEY-001');
    assert.equal(view!.payMethod, '微信');
    assert.equal(view!.tradeNo, 'E-OK-1');
    assert.equal(countUnusedKeys(productId), 1);

    const again = applyVerifiedTrade({
      outTradeNo: 'JMEPAYOK001',
      tradeStatus: 'TRADE_SUCCESS',
      tradeNo: 'E-OK-1',
      identity: { totalAmount: '1.00', pid: '1001' },
      source: 'notify',
      provider: 'epay',
    });
    assert.equal(again.ok, true);
    assert.equal(getPublicOrderView('JMEPAYOK001')!.keys.length, 1);
  });

  it('records payment_channel on cashier-like alipay orders', () => {
    const order = createOrder({
      outTradeNo: 'JMF2F001',
      subject: '收银台',
      totalAmount: '2.00',
      paymentChannel: 'alipay_f2f',
    });
    assert.equal(order.payment_channel, 'alipay_f2f');
    assert.equal(paymentChannelLabel(order.payment_channel), '支付宝');
  });
});
