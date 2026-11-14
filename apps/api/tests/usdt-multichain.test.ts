import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

const tmpDb = path.join(os.tmpdir(), `jima-usdt-multi-${Date.now()}.db`);
process.env.DATABASE_PATH = tmpDb;
process.env.SETTINGS_ENCRYPTION_KEY = 'test-encryption-key-32bytes!!!!';
process.env.SESSION_SECRET = 'test-session-secret';

const {
  assignUsdtPayment,
  applyTransferToPendingOrders,
  transferMatchesOrder,
  expireUsdtPendingOrders,
  listEnabledUsdtPaymentMethods,
  usdtPointsToOnChain,
  usdtToPoints,
  pointsToUsdt,
  setUsdtFetchForTests,
  USDT_FULFILL_GRACE_MINUTES,
} = await import('../src/usdt.js');
const {
  ERC20_TRANSFER_TOPIC,
  parseEvmUsdtTransfers,
} = await import('../src/usdtEvm.js');
const {
  USDT_NETWORKS,
  XLAYER_USDT0_CONTRACT,
  XLAYER_LEGACY_USDT_CONTRACT,
  OPTIMISM_USDT0_CONTRACT,
  usdtContracts,
  getUsdtNetwork,
} = await import('../src/usdtChains.js');
const {
  getDb,
  createProduct,
  saveUsdtSettings,
  listOccupiedUsdtAmounts,
  getOrderByOutTradeNo,
  updateOrder,
} = await import('../src/db.js');
const { importCardKeys, createReservedCheckoutOrder, getPublicOrderView } = await import(
  '../src/cardKeys.js'
);
const { listAvailablePaymentMethods } = await import('../src/paymentMethods.js');

const EVM_SHOP = '0x742d35Cc6634C0532925a3b844Bc9e7595f2bEB0';
const TRON_SHOP = 'TBXSw8fM4jpQkGc6zZjsVABFpVN7UvXPdV';

function evmLog(input: {
  txHash: string;
  to?: string;
  amount: string;
  decimals: number;
  contract: string;
  timestampMs?: number;
}) {
  const points = usdtToPoints(input.amount);
  const value = usdtPointsToOnChain(points, input.decimals);
  const to = (input.to || EVM_SHOP).toLowerCase();
  return {
    address: input.contract,
    topics: [
      ERC20_TRANSFER_TOPIC,
      '0x0000000000000000000000001111111111111111111111111111111111111111',
      `0x000000000000000000000000${to.slice(2)}`,
    ],
    data: `0x${value.toString(16).padStart(64, '0')}`,
    transactionHash: input.txHash,
    blockNumber: '0x64',
    timeStamp: Math.floor((input.timestampMs ?? Date.now()) / 1000),
  };
}

describe('usdt multi-chain options, precision and isolation', () => {
  let productId: number;

  before(() => {
    getDb();
    const p = createProduct({ name: '多链测试商品', price: '7.20', status: 'on' });
    productId = p.id;
    importCardKeys(
      productId,
      Array.from({ length: 16 }, (_, i) => `MULTI-KEY-${String(i + 1).padStart(2, '0')}`).join('\n'),
    );
    saveUsdtSettings({
      enabled: true,
      rate: '7.20',
      expireMinutes: 15,
      networks: {
        trc20: { enabled: true, address: TRON_SHOP },
        bep20: { enabled: true, address: EVM_SHOP },
        erc20: { enabled: false, address: EVM_SHOP },
        polygon: { enabled: true, address: EVM_SHOP },
        arbitrum: { enabled: true, address: EVM_SHOP },
        optimism: { enabled: false, address: '' },
        avax: { enabled: false, address: '' },
        xlayer: { enabled: true, address: EVM_SHOP },
      },
    });
  });

  after(() => {
    setUsdtFetchForTests(null);
    for (const f of [tmpDb, `${tmpDb}-wal`, `${tmpDb}-shm`]) {
      try {
        fs.unlinkSync(f);
      } catch {
        /* ignore */
      }
    }
  });

  it('lists each enabled chain as its own checkout option and hides disabled ones', () => {
    const channels = listEnabledUsdtPaymentMethods();
    assert.deepEqual(channels.sort(), [
      'usdt_arbitrum',
      'usdt_bep20',
      'usdt_polygon',
      'usdt_trc20',
      'usdt_xlayer',
    ]);
    const methods = listAvailablePaymentMethods({
      alipayConfigured: false,
      epayConfigured: false,
      epayChannels: [],
      usdtChannels: channels,
    });
    const ids = methods.map((m) => m.id);
    assert.ok(ids.includes('usdt_trc20'));
    assert.ok(ids.includes('usdt_bep20'));
    assert.ok(ids.includes('usdt_polygon'));
    assert.ok(ids.includes('usdt_arbitrum'));
    assert.ok(ids.includes('usdt_xlayer'));
    assert.ok(!ids.includes('usdt_erc20'));
    assert.ok(!ids.includes('usdt_optimism'));
    assert.ok(!ids.includes('usdt_avax'));
    assert.equal(methods.find((m) => m.id === 'usdt_bep20')?.label, 'USDT (BEP20)');
    assert.equal(methods.find((m) => m.id === 'usdt_xlayer')?.label, 'USDT (X Layer)');
    assert.equal(methods.find((m) => m.id === 'usdt_polygon')?.label, 'USDT (Polygon)');
  });

  it('matches BSC USDT using 18 on-chain decimals', () => {
    assert.equal(getUsdtNetwork('bep20').decimals, 18);
    assert.equal(usdtPointsToOnChain(10000, 18), 10n ** 18n);
    const reserved = createReservedCheckoutOrder({
      outTradeNo: 'JMBSC001',
      paymentChannel: 'usdt_bep20',
      paymentLabel: 'USDT (BEP20)',
      items: [{ productId, quantity: 1 }],
    });
    const payment = assignUsdtPayment(reserved.order.out_trade_no);
    assert.equal(payment.amount, '1.0000');
    assert.equal(payment.network, 'BEP20');
    assert.equal(payment.networkId, 'bep20');
    const order = getOrderByOutTradeNo('JMBSC001')!;
    assert.equal(order.usdt_network, 'bep20');
    const logs = [
      evmLog({
        txHash: '0x' + 'ab'.repeat(32),
        amount: payment.amount,
        decimals: 18,
        contract: USDT_NETWORKS.bep20.contract,
      }),
    ];
    const parsed = parseEvmUsdtTransfers({
      logs,
      def: USDT_NETWORKS.bep20,
      toAddress: EVM_SHOP,
    });
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].valueOnChain, 10n ** 18n);
    const transfer = {
      ...parsed[0],
      timestampMs: Date.now(),
    };
    assert.equal(transferMatchesOrder(transfer, order, EVM_SHOP.toLowerCase()), true);
    const applied = applyTransferToPendingOrders(transfer, EVM_SHOP, new Date());
    assert.equal(applied.applied, true, JSON.stringify(applied));
    const view = getPublicOrderView('JMBSC001');
    assert.equal(view!.paid, true);
    assert.equal(view!.keys.length, 1);
    assert.equal(view!.payMethod, 'USDT (BEP20)');
  });

  it('isolates unique amounts by chain, even when the EVM address is shared', () => {
    const tron = createReservedCheckoutOrder({
      outTradeNo: 'JMISO-TRON',
      paymentChannel: 'usdt_trc20',
      items: [{ productId, quantity: 1 }],
    });
    const payTron = assignUsdtPayment(tron.order.out_trade_no);
    assert.equal(payTron.amount, '1.0000');

    const polygon = createReservedCheckoutOrder({
      outTradeNo: 'JMISO-POLY',
      paymentChannel: 'usdt_polygon',
      items: [{ productId, quantity: 1 }],
    });
    const payPoly = assignUsdtPayment(polygon.order.out_trade_no);
    assert.equal(payPoly.amount, '1.0000');

    const arb = createReservedCheckoutOrder({
      outTradeNo: 'JMISO-ARB',
      paymentChannel: 'usdt_arbitrum',
      items: [{ productId, quantity: 1 }],
    });
    const payArb = assignUsdtPayment(arb.order.out_trade_no);
    assert.equal(payArb.amount, '1.0000');

    assert.deepEqual(listOccupiedUsdtAmounts(TRON_SHOP, new Date(), 'trc20'), ['1.0000']);
    assert.deepEqual(listOccupiedUsdtAmounts(EVM_SHOP, new Date(), 'polygon'), ['1.0000']);
    assert.deepEqual(listOccupiedUsdtAmounts(EVM_SHOP, new Date(), 'arbitrum'), ['1.0000']);
    assert.ok(!listOccupiedUsdtAmounts(EVM_SHOP, new Date(), 'bep20').includes('1.0000'));
  });

  it('does not fulfill a Polygon payment against an Arbitrum order at the same address', () => {
    const polyOrder = getOrderByOutTradeNo('JMISO-POLY')!;
    const arbOrder = getOrderByOutTradeNo('JMISO-ARB')!;
    const polyLog = evmLog({
      txHash: '0x' + 'cd'.repeat(32),
      amount: '1.0000',
      decimals: 6,
      contract: USDT_NETWORKS.polygon.contract,
    });
    const polyTx = {
      ...parseEvmUsdtTransfers({
        logs: [polyLog],
        def: USDT_NETWORKS.polygon,
        toAddress: EVM_SHOP,
      })[0],
      timestampMs: Date.now(),
    };
    assert.equal(transferMatchesOrder(polyTx, polyOrder, EVM_SHOP), true);
    assert.equal(transferMatchesOrder(polyTx, arbOrder, EVM_SHOP), false);
    const applied = applyTransferToPendingOrders(polyTx, EVM_SHOP);
    assert.equal(applied.applied, true);
    assert.equal(applied.outTradeNo, 'JMISO-POLY');
    assert.equal(getPublicOrderView('JMISO-POLY')!.paid, true);
    assert.equal(getPublicOrderView('JMISO-ARB')!.paid, false);
  });

  it('only delivers when the unique amount matches exactly', () => {
    const reserved = createReservedCheckoutOrder({
      outTradeNo: 'JMISO-ARB2',
      paymentChannel: 'usdt_arbitrum',
      items: [{ productId, quantity: 1 }],
    });
    const payment = assignUsdtPayment(reserved.order.out_trade_no);
    // previous arb order still occupies 1.0000
    assert.equal(payment.amount, '1.0001');
    const wrong = evmLog({
      txHash: '0x' + 'ee'.repeat(32),
      amount: '1.0000',
      decimals: 6,
      contract: USDT_NETWORKS.arbitrum.contract,
    });
    const wrongTx = {
      ...parseEvmUsdtTransfers({
        logs: [wrong],
        def: USDT_NETWORKS.arbitrum,
        toAddress: EVM_SHOP,
      })[0],
      timestampMs: Date.now(),
    };
    const order = getOrderByOutTradeNo('JMISO-ARB2')!;
    assert.equal(transferMatchesOrder(wrongTx, order, EVM_SHOP), false);
    applyTransferToPendingOrders(wrongTx, EVM_SHOP);
    // 1.0000 可能匹配到同链更早的待付单，但不得发给金额为 1.0001 的本单
    assert.equal(getPublicOrderView('JMISO-ARB2')!.paid, false);
    assert.notEqual(getOrderByOutTradeNo('JMISO-ARB2')!.usdt_amount, '1.0000');
  });

  it('accepts official USDT0 and legacy USDT on X Layer at 6 decimals', () => {
    assert.equal(USDT_NETWORKS.xlayer.chainId, 196);
    assert.equal(USDT_NETWORKS.xlayer.decimals, 6);
    assert.equal(USDT_NETWORKS.xlayer.contract.toLowerCase(), XLAYER_USDT0_CONTRACT.toLowerCase());
    const reserved = createReservedCheckoutOrder({
      outTradeNo: 'JMXL001',
      paymentChannel: 'usdt_xlayer',
      paymentLabel: 'USDT (X Layer)',
      items: [{ productId, quantity: 1 }],
    });
    const payment = assignUsdtPayment(reserved.order.out_trade_no);
    const official = evmLog({
      txHash: '0x' + '11'.repeat(32),
      amount: payment.amount,
      decimals: 6,
      contract: XLAYER_USDT0_CONTRACT,
    });
    const officialTx = {
      ...parseEvmUsdtTransfers({
        logs: [official],
        def: USDT_NETWORKS.xlayer,
        toAddress: EVM_SHOP,
      })[0],
      timestampMs: Date.now(),
    };
    assert.equal(officialTx.valueOnChain, usdtPointsToOnChain(usdtToPoints(payment.amount), 6));
    const applied = applyTransferToPendingOrders(officialTx, EVM_SHOP);
    assert.equal(applied.applied, true, JSON.stringify(applied));
    assert.equal(getPublicOrderView('JMXL001')!.paid, true);

    const reserved2 = createReservedCheckoutOrder({
      outTradeNo: 'JMXL002',
      paymentChannel: 'usdt_xlayer',
      items: [{ productId, quantity: 1 }],
    });
    const payment2 = assignUsdtPayment(reserved2.order.out_trade_no);
    const legacy = evmLog({
      txHash: '0x' + '22'.repeat(32),
      amount: payment2.amount,
      decimals: 6,
      contract: XLAYER_LEGACY_USDT_CONTRACT,
    });
    const legacyParsed = parseEvmUsdtTransfers({
      logs: [legacy],
      def: USDT_NETWORKS.xlayer,
      toAddress: EVM_SHOP,
    });
    assert.equal(legacyParsed.length, 1);
    const applied2 = applyTransferToPendingOrders(
      { ...legacyParsed[0], timestampMs: Date.now() },
      EVM_SHOP,
    );
    assert.equal(applied2.applied, true, JSON.stringify(applied2));
    assert.equal(getPublicOrderView('JMXL002')!.paid, true);
  });

  it('keeps unique amount occupied during grace and releases only after grace', () => {
    const reserved = createReservedCheckoutOrder({
      outTradeNo: 'JMBSC-GRACE',
      paymentChannel: 'usdt_bep20',
      items: [{ productId, quantity: 1 }],
    });
    const payment = assignUsdtPayment(reserved.order.out_trade_no);
    updateOrder('JMBSC-GRACE', {
      usdt_expire_at: new Date(Date.now() - 60_000).toISOString(),
    });
    assert.ok(listOccupiedUsdtAmounts(EVM_SHOP, new Date(), 'bep20').includes(payment.amount));
    assert.equal(expireUsdtPendingOrders(), 0);
    assert.notEqual(getOrderByOutTradeNo('JMBSC-GRACE')?.status, 'TRADE_CLOSED');

    const now = Date.now();
    const created = now - 16 * 60_000;
    const expire = now - 60_000;
    getDb()
      .prepare(`UPDATE orders SET created_at = ?, usdt_expire_at = ? WHERE out_trade_no = ?`)
      .run(new Date(created).toISOString(), new Date(expire).toISOString(), 'JMBSC-GRACE');
    const lateButInWindow = evmLog({
      txHash: '0x' + '33'.repeat(32),
      amount: payment.amount,
      decimals: 18,
      contract: USDT_NETWORKS.bep20.contract,
      timestampMs: expire - 1_000,
    });
    const tx = {
      ...parseEvmUsdtTransfers({
        logs: [lateButInWindow],
        def: USDT_NETWORKS.bep20,
        toAddress: EVM_SHOP,
      })[0],
      timestampMs: expire - 1_000,
    };
    const order = getOrderByOutTradeNo('JMBSC-GRACE')!;
    assert.equal(transferMatchesOrder(tx, order, EVM_SHOP, new Date(now)), true);
    const applied = applyTransferToPendingOrders(tx, EVM_SHOP, new Date(now));
    assert.equal(applied.applied, true);
    assert.equal(getPublicOrderView('JMBSC-GRACE')!.paid, true);
    void pointsToUsdt;
    void USDT_FULFILL_GRACE_MINUTES;
  });

  it('accepts official USDT0 and classic Tether on Optimism at 6 decimals', () => {
    const classic = '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58';
    assert.equal(USDT_NETWORKS.optimism.chainId, 10);
    assert.equal(USDT_NETWORKS.optimism.decimals, 6);
    assert.equal(USDT_NETWORKS.optimism.contract.toLowerCase(), classic.toLowerCase());
    const contracts = usdtContracts(USDT_NETWORKS.optimism).map((c) => c.toLowerCase());
    assert.ok(contracts.includes(classic.toLowerCase()));
    assert.ok(contracts.includes(OPTIMISM_USDT0_CONTRACT.toLowerCase()));

    saveUsdtSettings({
      enabled: true,
      rate: '7.20',
      expireMinutes: 15,
      networks: { optimism: { enabled: true, address: EVM_SHOP } },
    });

    const reserved = createReservedCheckoutOrder({
      outTradeNo: 'JMOP-USDT0',
      paymentChannel: 'usdt_optimism',
      paymentLabel: 'USDT (Optimism)',
      items: [{ productId, quantity: 1 }],
    });
    const payment = assignUsdtPayment(reserved.order.out_trade_no);
    const official = evmLog({
      txHash: '0x' + 'a1'.repeat(32),
      amount: payment.amount,
      decimals: 6,
      contract: OPTIMISM_USDT0_CONTRACT,
    });
    const officialParsed = parseEvmUsdtTransfers({
      logs: [official],
      def: USDT_NETWORKS.optimism,
      toAddress: EVM_SHOP,
    });
    assert.equal(officialParsed.length, 1);
    const applied = applyTransferToPendingOrders(
      { ...officialParsed[0], timestampMs: Date.now() },
      EVM_SHOP,
    );
    assert.equal(applied.applied, true, JSON.stringify(applied));
    assert.equal(getPublicOrderView('JMOP-USDT0')!.paid, true);

    const reserved2 = createReservedCheckoutOrder({
      outTradeNo: 'JMOP-CLASSIC',
      paymentChannel: 'usdt_optimism',
      items: [{ productId, quantity: 1 }],
    });
    const payment2 = assignUsdtPayment(reserved2.order.out_trade_no);
    const legacy = evmLog({
      txHash: '0x' + 'a2'.repeat(32),
      amount: payment2.amount,
      decimals: 6,
      contract: classic,
    });
    const legacyParsed = parseEvmUsdtTransfers({
      logs: [legacy],
      def: USDT_NETWORKS.optimism,
      toAddress: EVM_SHOP,
    });
    assert.equal(legacyParsed.length, 1);
    const applied2 = applyTransferToPendingOrders(
      { ...legacyParsed[0], timestampMs: Date.now() },
      EVM_SHOP,
    );
    assert.equal(applied2.applied, true, JSON.stringify(applied2));
    assert.equal(getPublicOrderView('JMOP-CLASSIC')!.paid, true);
  });
});
