import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

const tmpDb = path.join(os.tmpdir(), `jima-usdt-${Date.now()}.db`);
process.env.DATABASE_PATH = tmpDb;
process.env.SETTINGS_ENCRYPTION_KEY = 'test-encryption-key-32bytes!!!!';
process.env.SESSION_SECRET = 'test-session-secret';

const {
  isTronAddress,
  normalizeUsdtRate,
  cnyToUsdtPoints,
  pointsToUsdt,
  usdtToPoints,
  allocateUniqueUsdtAmount,
  occupiedPointsFromAmounts,
  assignUsdtPayment,
  fulfillUsdtOrder,
  parseTrc20Transfers,
  transferMatchesOrder,
  applyTransferToPendingOrders,
  expireUsdtPendingOrders,
  processUsdtNotify,
  setUsdtFetchForTests,
  usdtPointsToOnChain,
  signUsdtNotifyParams,
  usdtNotifySecret,
  usdtQrContent,
  validateUsdtConfig,
  USDT_TRC20_CONTRACT,
  USDT_FULFILL_GRACE_MINUTES,
  scanUsdtDeposits,
  fetchUsdtTransfers,
  fetchUsdtTransferByHash,
  parseUsdtTransferFromTransaction,
  getUsdtScanStatus,
  resetUsdtScanForTests,
  tronAddressToHex,
  tronHexToBase58,
} = await import('../src/usdt.js');
const {
  getDb,
  createProduct,
  saveUsdtSettings,
  loadUsdtSettings,
  usdtConfigured,
  paymentConfigured,
  settingsConfigured,
  epayConfigured,
  listOccupiedUsdtAmounts,
  getOrderByOutTradeNo,
  updateOrder,
} = await import('../src/db.js');
const {
  importCardKeys,
  createReservedCheckoutOrder,
  getPublicOrderView,
  countUnusedKeys,
} = await import('../src/cardKeys.js');
const { listAvailablePaymentMethods, normalizeEpayChannels } = await import(
  '../src/paymentMethods.js'
);

const SHOP_ADDRESS = 'TBXSw8fM4jpQkGc6zZjsVABFpVN7UvXPdV';

function transferFixture(input: {
  txHash: string;
  to?: string;
  amount: string;
  timestampMs?: number;
}) {
  const points = usdtToPoints(input.amount);
  return {
    transaction_id: input.txHash,
    to: input.to || SHOP_ADDRESS,
    from: 'TFromFromFromFromFromFromFromFrom1',
    value: String(usdtPointsToOnChain(points)),
    block_timestamp: input.timestampMs ?? Date.now(),
    token_info: { symbol: 'USDT', address: USDT_TRC20_CONTRACT, decimals: 6 },
  };
}


function officialTxFixture(input: {
  txHash: string;
  to?: string;
  amount: string;
  timestampMs?: number;
}) {
  const to = input.to || SHOP_ADDRESS;
  const toHex = tronAddressToHex(to);
  if (!toHex) throw new Error('bad address');
  const amountHex = usdtPointsToOnChain(usdtToPoints(input.amount)).toString(16).padStart(64, '0');
  const data = `a9059cbb${toHex.slice(2).padStart(64, '0')}${amountHex}`;
  return {
    data: [
      {
        ret: [{ contractRet: 'SUCCESS' }],
        txID: input.txHash,
        raw_data: {
          contract: [
            {
              type: 'TriggerSmartContract',
              parameter: {
                value: {
                  data,
                  owner_address: SHOP_ADDRESS,
                  contract_address: USDT_TRC20_CONTRACT,
                },
              },
            },
          ],
          timestamp: input.timestampMs ?? Date.now(),
        },
      },
    ],
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function setOrderWindow(outTradeNo: string, createdMs: number, expireMs: number) {
  getDb()
    .prepare(
      `UPDATE orders SET created_at = ?, usdt_expire_at = ? WHERE out_trade_no = ?`,
    )
    .run(new Date(createdMs).toISOString(), new Date(expireMs).toISOString(), outTradeNo);
}

describe('usdt helpers and independent channel', () => {
  it('validates TRC20 addresses and rates', () => {
    assert.equal(isTronAddress(SHOP_ADDRESS), true);
    assert.equal(isTronAddress('TBXSw8fM4jpQkGc6zZjsVABFpVN7UvXPdx'), false);
    assert.equal(isTronAddress('not-an-address'), false);
    assert.equal(normalizeUsdtRate('7.20'), '7.20');
    assert.equal(normalizeUsdtRate('0'), null);
    assert.equal(normalizeUsdtRate('-1'), null);
    assert.equal(cnyToUsdtPoints('7.20', '7.20'), 10000);
    assert.equal(pointsToUsdt(10000), '1.0000');
    assert.equal(cnyToUsdtPoints('10.00', '7.2'), 13889);
    assert.equal(pointsToUsdt(13889), '1.3889');
  });

  it('allocates unique 4-decimal amounts by stepping 0.0001', () => {
    const occupied = occupiedPointsFromAmounts(['1.0000', '1.0001']);
    assert.equal(allocateUniqueUsdtAmount(10000, occupied), 10002);
    assert.equal(pointsToUsdt(10002), '1.0002');
    assert.equal(usdtQrContent(SHOP_ADDRESS, '1.0002').includes(SHOP_ADDRESS), true);
  });

  it('is not an epay channel and can be listed independently', () => {
    assert.deepEqual(normalizeEpayChannels(['alipay', 'usdt', 'usdt_trc20']), ['alipay']);
    const methods = listAvailablePaymentMethods({
      alipayConfigured: true,
      epayConfigured: true,
      epayChannels: ['alipay'],
      usdtConfigured: true,
    });
    assert.ok(methods.some((m) => m.id === 'alipay_f2f'));
    assert.ok(methods.some((m) => m.id === 'epay_alipay'));
    assert.ok(methods.some((m) => m.id === 'usdt_trc20' && m.label === 'USDT (TRC20)'));
    assert.ok(!methods.some((m) => m.id === 'epay_usdt'));
  });
});

describe('usdt occupancy, expiry and fulfillment', () => {
  let productId: number;

  before(() => {
    getDb();
    const p = createProduct({
      name: 'USDT 测试商品',
      price: '7.20',
      status: 'on',
    });
    productId = p.id;
    importCardKeys(productId, 'USDT-KEY-001\nUSDT-KEY-002\nUSDT-KEY-003\nUSDT-KEY-004\nUSDT-KEY-005\nUSDT-KEY-006\nUSDT-KEY-007\nUSDT-KEY-008\nUSDT-KEY-009\nUSDT-KEY-010\nUSDT-KEY-011\nUSDT-KEY-012');
    saveUsdtSettings({
      enabled: true,
      address: SHOP_ADDRESS,
      rate: '7.20',
      expireMinutes: 15,
    });
  });

  after(() => {
    setUsdtFetchForTests(null);
    resetUsdtScanForTests();
    for (const f of [tmpDb, tmpDb + '-wal', tmpDb + '-shm']) {
      try {
        fs.unlinkSync(f);
      } catch {
        /* ignore */
      }
    }
  });

  it('saves optional USDT settings and does not require official Alipay or epay', () => {
    assert.equal(settingsConfigured(), false);
    assert.equal(epayConfigured(), false);
    assert.equal(usdtConfigured(), true);
    assert.equal(paymentConfigured(), true);
    const loaded = loadUsdtSettings();
    assert.ok(loaded);
    assert.equal(loaded!.address, SHOP_ADDRESS);
    assert.equal(loaded!.rate, '7.20');
    const check = validateUsdtConfig(loaded);
    assert.equal(check.ok, true);
  });

  it('occupies a unique amount, keeps it during grace, and releases after grace', () => {
    const a = createReservedCheckoutOrder({
      outTradeNo: 'JMUSDT001',
      paymentChannel: 'usdt_trc20',
      paymentLabel: 'USDT',
      items: [{ productId, quantity: 1 }],
    });
    const payA = assignUsdtPayment(a.order.out_trade_no);
    assert.equal(payA.amount, '1.0000');
    assert.equal(payA.address, SHOP_ADDRESS);

    const b = createReservedCheckoutOrder({
      outTradeNo: 'JMUSDT002',
      paymentChannel: 'usdt_trc20',
      items: [{ productId, quantity: 1 }],
    });
    const payB = assignUsdtPayment(b.order.out_trade_no);
    assert.equal(payB.amount, '1.0001');
    assert.deepEqual(listOccupiedUsdtAmounts(SHOP_ADDRESS).sort(), ['1.0000', '1.0001']);

    updateOrder('JMUSDT002', {
      usdt_expire_at: new Date(Date.now() - 60_000).toISOString(),
    });
    assert.deepEqual(listOccupiedUsdtAmounts(SHOP_ADDRESS).sort(), ['1.0000', '1.0001']);
    assert.equal(expireUsdtPendingOrders(), 0);
    assert.notEqual(getOrderByOutTradeNo('JMUSDT002')?.status, 'TRADE_CLOSED');

    updateOrder('JMUSDT002', {
      usdt_expire_at: new Date(Date.now() - (USDT_FULFILL_GRACE_MINUTES * 60_000 + 5_000)).toISOString(),
    });
    const expired = expireUsdtPendingOrders();
    assert.ok(expired >= 1);
    assert.equal(getOrderByOutTradeNo('JMUSDT002')?.status, 'TRADE_CLOSED');
    assert.deepEqual(listOccupiedUsdtAmounts(SHOP_ADDRESS), ['1.0000']);

    const c = createReservedCheckoutOrder({
      outTradeNo: 'JMUSDT003',
      paymentChannel: 'usdt_trc20',
      items: [{ productId, quantity: 1 }],
    });
    const payC = assignUsdtPayment(c.order.out_trade_no);
    assert.equal(payC.amount, '1.0001');
  });

  it('fulfills only an exact unique amount and rejects a reused transaction hash', () => {
    const unusedBefore = countUnusedKeys(productId);
    const transfer = parseTrc20Transfers({
      data: [transferFixture({ txHash: 'tx-exact-1', amount: '1.0000' })],
    })[0];
    const order = getOrderByOutTradeNo('JMUSDT001')!;
    assert.equal(transferMatchesOrder(transfer, order, SHOP_ADDRESS), true);

    const wrong = fulfillUsdtOrder({
      outTradeNo: 'JMUSDT001',
      txHash: 'tx-wrong-amt',
      actualAmount: '1.0001',
    });
    assert.equal(wrong.ok, false);
    assert.equal(wrong.ok ? '' : wrong.reason, 'usdt_amount_mismatch');
    assert.equal(getPublicOrderView('JMUSDT001')!.paid, false);

    const applied = applyTransferToPendingOrders(transfer, SHOP_ADDRESS);
    assert.equal(applied.applied, true);
    const view = getPublicOrderView('JMUSDT001');
    assert.equal(view!.paid, true);
    assert.equal(view!.keys.length, 1);
    assert.equal(view!.keys[0].secret, 'USDT-KEY-001');
    assert.equal(view!.payMethod, 'USDT');
    assert.equal(view!.tradeNo, 'tx-exact-1');

    const other = createReservedCheckoutOrder({
      outTradeNo: 'JMUSDT004',
      paymentChannel: 'usdt_trc20',
      items: [{ productId, quantity: 1 }],
    });
    const payOther = assignUsdtPayment(other.order.out_trade_no);
    const reused = fulfillUsdtOrder({
      outTradeNo: 'JMUSDT004',
      txHash: 'tx-exact-1',
      actualAmount: payOther.amount,
    });
    assert.equal(reused.ok, false);
    assert.equal(reused.ok ? '' : reused.reason, 'tx_reused');
    assert.equal(getPublicOrderView('JMUSDT004')!.paid, false);
  });

  it('accepts a verified notify and rejects unsigned or mismatched ones', async () => {
    const reserved = createReservedCheckoutOrder({
      outTradeNo: 'JMUSDT006',
      paymentChannel: 'usdt_trc20',
      items: [{ productId, quantity: 1 }],
    });
    const payment = assignUsdtPayment(reserved.order.out_trade_no);
    const order = getOrderByOutTradeNo('JMUSDT006')!;
    const amount = order.usdt_amount!;
    assert.equal(amount, payment.amount);
    const txHash = 'tx-notify-ok';
    setUsdtFetchForTests(async () => {
      return new Response(
        JSON.stringify({ data: [transferFixture({ txHash, amount })] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });

    const bad = await processUsdtNotify({
      tx_hash: txHash,
      actual_amount: '9.9999',
      order_id: 'JMUSDT006',
    });
    assert.equal(bad.ok, false);

    const unsignedMissing = await processUsdtNotify({
      order_id: 'JMUSDT006',
      actual_amount: amount,
    });
    assert.equal(unsignedMissing.ok, false);
    assert.equal(unsignedMissing.reason, 'tx_missing');

    const ok = await processUsdtNotify({
      tx_hash: txHash,
      order_id: 'JMUSDT006',
      actual_amount: amount,
    });
    assert.equal(ok.reason, 'applied', JSON.stringify(ok));
    assert.equal(ok.ok, true);
    assert.equal(getPublicOrderView('JMUSDT006')!.paid, true);

    // 链上查不到时，仅带有效服务端签名且金额精确的补通知可通过
    const late = createReservedCheckoutOrder({
      outTradeNo: 'JMUSDT005',
      paymentChannel: 'usdt_trc20',
      items: [{ productId, quantity: 1 }],
    });
    const payLate = assignUsdtPayment(late.order.out_trade_no);
    setUsdtFetchForTests(async () => {
      return new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    const params = {
      order_id: 'JMUSDT005',
      tx_hash: 'tx-signed-late',
      actual_amount: payLate.amount,
    };
    const unsigned = await processUsdtNotify(params);
    assert.equal(unsigned.ok, false);
    const signed = await processUsdtNotify({
      ...params,
      signature: signUsdtNotifyParams(params, usdtNotifySecret()),
    });
    assert.equal(signed.ok, true);
    assert.equal(getPublicOrderView('JMUSDT005')!.paid, true);
  });

  it('fulfills when now is past expiry but the block time is inside the payment window', () => {
    const reserved = createReservedCheckoutOrder({
      outTradeNo: 'JMUSDT010',
      paymentChannel: 'usdt_trc20',
      items: [{ productId, quantity: 1 }],
    });
    const payment = assignUsdtPayment(reserved.order.out_trade_no);
    const now = Date.now();
    const created = now - 16 * 60_000;
    const expire = now - 60_000;
    setOrderWindow('JMUSDT010', created, expire);
    const order = getOrderByOutTradeNo('JMUSDT010')!;
    const inWindow = parseTrc20Transfers({
      data: [transferFixture({ txHash: 'tx-grace-in-window', amount: payment.amount, timestampMs: expire - 1_000 })],
    })[0];
    assert.equal(transferMatchesOrder(inWindow, order, SHOP_ADDRESS, new Date(now)), true);
    const applied = applyTransferToPendingOrders(inWindow, SHOP_ADDRESS, new Date(now));
    assert.equal(applied.applied, true);
    assert.equal(getPublicOrderView('JMUSDT010')!.paid, true);
  });

  it('rejects a transfer whose block time is after expiry', () => {
    const reserved = createReservedCheckoutOrder({
      outTradeNo: 'JMUSDT011',
      paymentChannel: 'usdt_trc20',
      items: [{ productId, quantity: 1 }],
    });
    const payment = assignUsdtPayment(reserved.order.out_trade_no);
    const now = Date.now();
    const created = now - 16 * 60_000;
    const expire = now - 60_000;
    setOrderWindow('JMUSDT011', created, expire);
    const order = getOrderByOutTradeNo('JMUSDT011')!;
    const late = parseTrc20Transfers({
      data: [transferFixture({ txHash: 'tx-after-expire', amount: payment.amount, timestampMs: expire + 2_000 })],
    })[0];
    assert.equal(transferMatchesOrder(late, order, SHOP_ADDRESS, new Date(now)), false);
    const applied = applyTransferToPendingOrders(late, SHOP_ADDRESS, new Date(now));
    assert.equal(applied.applied, false);
    assert.equal(getPublicOrderView('JMUSDT011')!.paid, false);
  });

  it('paginates TronGrid transfers and can match a transaction on page 2', async () => {
    const reserved = createReservedCheckoutOrder({
      outTradeNo: 'JMUSDT012',
      paymentChannel: 'usdt_trc20',
      items: [{ productId, quantity: 1 }],
    });
    const payment = assignUsdtPayment(reserved.order.out_trade_no);
    const filler = transferFixture({ txHash: 'tx-page1-other', amount: '9.9999' });
    const match = transferFixture({ txHash: 'tx-page2-hit', amount: payment.amount });
    const seenConfirmed: boolean[] = [];
    setUsdtFetchForTests(async (url) => {
      const u = new URL(url);
      seenConfirmed.push(u.searchParams.get('only_confirmed') === 'true');
      if (u.pathname.includes('/transactions/trc20')) {
        const fp = u.searchParams.get('fingerprint');
        if (!fp) {
          return jsonResponse({
            data: [filler],
            meta: { fingerprint: 'page-2', links: { next: 'https://api.trongrid.io/v1/accounts/x/transactions/trc20?fingerprint=page-2' } },
          });
        }
        if (fp === 'page-2') {
          return jsonResponse({ data: [match], meta: {} });
        }
      }
      return jsonResponse({ data: [] });
    });
    const fetched = await fetchUsdtTransfers({ address: SHOP_ADDRESS });
    assert.equal(fetched.ok, true);
    assert.equal(fetched.transfers.some((t) => t.txHash === 'tx-page2-hit'), true);
    assert.ok(seenConfirmed.includes(true));
    const scan = await scanUsdtDeposits();
    assert.ok(scan.applied >= 1);
    assert.equal(getPublicOrderView('JMUSDT012')!.paid, true);
  });

  it('looks up a transfer by hash via the official transaction API, not the last-50 list', async () => {
    const reserved = createReservedCheckoutOrder({
      outTradeNo: 'JMUSDT013',
      paymentChannel: 'usdt_trc20',
      items: [{ productId, quantity: 1 }],
    });
    const payment = assignUsdtPayment(reserved.order.out_trade_no);
    const txHash = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    let listedLast50 = false;
    let hashed = false;
    setUsdtFetchForTests(async (url) => {
      const u = new URL(url);
      if (u.pathname.includes('/transactions/trc20')) {
        listedLast50 = true;
        return jsonResponse({ data: [] });
      }
      if (u.pathname.includes(`/v1/transactions/${txHash}`)) {
        hashed = true;
        return jsonResponse(officialTxFixture({ txHash, amount: payment.amount }));
      }
      return jsonResponse({ data: [] }, 404);
    });
    const parsed = parseUsdtTransferFromTransaction(
      officialTxFixture({ txHash, amount: payment.amount }),
      SHOP_ADDRESS,
    );
    assert.ok(parsed);
    assert.equal(parsed!.txHash, txHash);
    const found = await fetchUsdtTransferByHash(SHOP_ADDRESS, txHash);
    assert.equal(listedLast50, false);
    assert.equal(hashed, true);
    assert.ok(found);
    assert.equal(found!.txHash, txHash);
    const ok = await processUsdtNotify({
      tx_hash: txHash,
      order_id: 'JMUSDT013',
      actual_amount: payment.amount,
    });
    assert.equal(ok.ok, true, JSON.stringify(ok));
    assert.equal(getPublicOrderView('JMUSDT013')!.paid, true);
  });

  it('still fulfills pending orders on a previous address after the admin changes it', async () => {
    const oldAddress = USDT_TRC20_CONTRACT;
    assert.equal(Boolean(tronHexToBase58(tronAddressToHex(oldAddress) || '')), true);
    const reserved = createReservedCheckoutOrder({
      outTradeNo: 'JMUSDT014',
      paymentChannel: 'usdt_trc20',
      items: [{ productId, quantity: 1 }],
    });
    const payment = assignUsdtPayment(reserved.order.out_trade_no);
    updateOrder('JMUSDT014', { usdt_address: oldAddress });
    const amount = getOrderByOutTradeNo('JMUSDT014')!.usdt_amount!;
    assert.equal(amount, payment.amount);
    setUsdtFetchForTests(async (url) => {
      const u = new URL(url);
      if (u.pathname.includes(`/accounts/${oldAddress}/transactions/trc20`)) {
        return jsonResponse({
          data: [transferFixture({ txHash: 'tx-old-addr', amount, to: oldAddress })],
        });
      }
      if (u.pathname.includes('/transactions/trc20')) {
        return jsonResponse({ data: [] });
      }
      return jsonResponse({ data: [] });
    });
    const scan = await scanUsdtDeposits();
    assert.ok(scan.applied >= 1, JSON.stringify(scan));
    assert.equal(getPublicOrderView('JMUSDT014')!.paid, true);
  });

  it('keeps scanning pending orders after the USDT switch is turned off', async () => {
    const reserved = createReservedCheckoutOrder({
      outTradeNo: 'JMUSDT015',
      paymentChannel: 'usdt_trc20',
      items: [{ productId, quantity: 1 }],
    });
    const payment = assignUsdtPayment(reserved.order.out_trade_no);
    saveUsdtSettings({
      enabled: false,
      address: SHOP_ADDRESS,
      rate: '7.20',
      expireMinutes: 15,
    });
    setUsdtFetchForTests(async (url) => {
      const u = new URL(url);
      if (u.pathname.includes('/transactions/trc20')) {
        return jsonResponse({
          data: [transferFixture({ txHash: 'tx-disabled-switch', amount: payment.amount })],
        });
      }
      return jsonResponse({ data: [] });
    });
    const scan = await scanUsdtDeposits();
    assert.ok(scan.applied >= 1, JSON.stringify(scan));
    assert.equal(getPublicOrderView('JMUSDT015')!.paid, true);
    saveUsdtSettings({
      enabled: true,
      address: SHOP_ADDRESS,
      rate: '7.20',
      expireMinutes: 15,
    });
  });

  it('does not close pending orders when the chain query fails', async () => {
    const reserved = createReservedCheckoutOrder({
      outTradeNo: 'JMUSDT016',
      paymentChannel: 'usdt_trc20',
      items: [{ productId, quantity: 1 }],
    });
    assignUsdtPayment(reserved.order.out_trade_no);
    const now = Date.now();
    setOrderWindow('JMUSDT016', now - 40 * 60_000, now - (USDT_FULFILL_GRACE_MINUTES * 60_000 + 10_000));
    setUsdtFetchForTests(async () => jsonResponse({ error: 'rate limited' }, 429));
    const scan = await scanUsdtDeposits();
    assert.equal(scan.applied, 0);
    assert.notEqual(getOrderByOutTradeNo('JMUSDT016')?.status, 'TRADE_CLOSED');
    const status = getUsdtScanStatus();
    assert.ok(status);
    assert.equal(status!.ok, false);
    assert.ok(status!.error);

    setUsdtFetchForTests(async () => jsonResponse({ data: [] }));
    await scanUsdtDeposits();
    assert.equal(getOrderByOutTradeNo('JMUSDT016')?.status, 'TRADE_CLOSED');
  });
});
