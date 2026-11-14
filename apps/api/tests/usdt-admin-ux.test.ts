import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

const tmpDb = path.join(os.tmpdir(), `jima-usdt-ux-${Date.now()}.db`);
process.env.DATABASE_PATH = tmpDb;
process.env.SETTINGS_ENCRYPTION_KEY = 'test-encryption-key-32bytes!!!!';
process.env.SESSION_SECRET = 'test-session-secret';

const {
  applyAddressAutoEnable,
  summarizeUsdtConfig,
  validateUsdtConfig,
} = await import('../src/usdt.js');
const { getDb, saveUsdtSettings, loadUsdtSettings, usdtConfigured } = await import('../src/db.js');

const TRON = 'TBXSw8fM4jpQkGc6zZjsVABFpVN7UvXPdV';
const EVM = '0x1111111111111111111111111111111111111111';

describe('USDT admin save semantics and config summary', () => {
  before(() => {
    getDb();
  });

  after(() => {
    for (const f of [tmpDb, `${tmpDb}-wal`, `${tmpDb}-shm`]) {
      try {
        fs.unlinkSync(f);
      } catch {
        /* ignore */
      }
    }
  });

  it('treats a valid address as enabled even if the chain switch was left off', () => {
    const trc = applyAddressAutoEnable('trc20', { enabled: false, address: TRON });
    assert.equal(trc.ok, true);
    if (trc.ok) {
      assert.equal(trc.enabled, true);
      assert.equal(trc.address, TRON);
    }
    const evm = applyAddressAutoEnable('bep20', { enabled: false, address: EVM });
    assert.equal(evm.ok, true);
    if (evm.ok) assert.equal(evm.enabled, true);
  });

  it('errors clearly when the chain is turned on without an address', () => {
    const r = applyAddressAutoEnable('polygon', { enabled: true, address: '' });
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.match(r.error, /请填写该链收款地址/);
      assert.match(r.error, /Polygon/);
    }
  });

  it('still rejects invalid TRC20 and EVM addresses', () => {
    const badTron = applyAddressAutoEnable('trc20', { enabled: false, address: EVM });
    assert.equal(badTron.ok, false);
    if (!badTron.ok) assert.match(badTron.error, /TRC20/);
    const badEvm = applyAddressAutoEnable('erc20', { enabled: false, address: TRON });
    assert.equal(badEvm.ok, false);
    if (!badEvm.ok) assert.match(badEvm.error, /ERC20/);
  });

  it('leaves a chain disabled when both the switch and address are empty', () => {
    const r = applyAddressAutoEnable('avax', { enabled: false, address: '  ' });
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.enabled, false);
      assert.equal(r.address, '');
    }
  });

  it('lists live chains in the save/check message', () => {
    saveUsdtSettings({
      enabled: true,
      rate: '7.20',
      expireMinutes: 15,
      networks: {
        trc20: { enabled: true, address: TRON },
        bep20: { enabled: true, address: EVM },
        erc20: { enabled: false, address: '' },
      },
    });
    const report = summarizeUsdtConfig(loadUsdtSettings());
    assert.equal(report.ok, true);
    assert.equal(usdtConfigured(), true);
    assert.match(report.message, /已开通 USDT 收款：TRC20、BEP20/);
    assert.match(report.message, /买家结账时可以选择这些网络/);
    assert.deepEqual(
      report.ready.map((r) => r.id),
      ['trc20', 'bep20'],
    );
    assert.equal(validateUsdtConfig().ok, true);
  });

  it('keeps filled chains when the master switch is off, but is not ready for buyers', () => {
    saveUsdtSettings({
      enabled: false,
      rate: '7.20',
      expireMinutes: 15,
    });
    const report = summarizeUsdtConfig(loadUsdtSettings());
    assert.equal(report.ok, false);
    assert.equal(usdtConfigured(), false);
    assert.deepEqual(
      report.ready.map((r) => r.id),
      ['trc20', 'bep20'],
    );
    assert.match(report.message, /总开关已关闭/);
    assert.match(report.message, /TRC20、BEP20/);
  });
});
