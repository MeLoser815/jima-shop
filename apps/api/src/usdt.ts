import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { config } from './config.js';
import {
  getDb,
  getOrderByOutTradeNo,
  getOrderByUsdtTxHash,
  inspectUsdtSettings,
  listEnabledUsdtChannels,
  listExpiredUsdtOrders,
  listOccupiedUsdtAmounts,
  listPendingUsdtOrders,
  loadUsdtSettings,
  orderUsdtNetwork,
  setOrderReservationUntil,
  updateOrder,
  DEFAULT_USDT_EXPIRE_MINUTES,
  USDT_FULFILL_GRACE_MINUTES,
  usdtGraceDeadlineMs,
  type OrderRow,
  type UsdtSettings,
} from './db.js';
import { yuanToFen } from './money.js';
import {
  isPaidStatus,
  markOrderPaidAndDeliverKeys,
  releaseReservationsForOrder,
} from './cardKeys.js';
import { isUsdtPaymentChannel, type PaymentMethodId } from './paymentMethods.js';
import {
  USDT_NETWORKS,
  USDT_NETWORK_IDS,
  buildUsdtQrContent,
  evmAddressesEqual,
  getUsdtNetwork,
  isEvmAddress,
  isUsdtNetworkId,
  normalizeEvmAddress,
  officialRpcHosts,
  usdtChannelFromNetwork,
  usdtNetworkFromChannel,
  usdtPointsToOnChain as pointsToOnChainDecimals,
  onChainToUsdtPoints as onChainToPointsDecimals,
  type UsdtNetworkId,
} from './usdtChains.js';
import { fetchEvmUsdtTransferByHash, fetchEvmUsdtTransfers, type EvmUsdtTransfer } from './usdtEvm.js';
import {
  officialHttpsRequest,
  sanitizeUsdtLog as sanitizeRpcLog,
  setUsdtFetchForTests as setSharedUsdtFetchForTests,
} from './usdtRpc.js';

export const USDT_DECIMALS = 4;
export const USDT_ONCHAIN_DECIMALS = 6;
export const USDT_AMOUNT_STEP_POINTS = 1; // 0.0001
export const USDT_MAX_UNIQUE_TRIES = 1000;
export const TRONGRID_HOST = 'api.trongrid.io';
export const TRONGRID_BASE = `https://${TRONGRID_HOST}`;
/** USDT TRC20 合约 */
export const USDT_TRC20_CONTRACT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
export const TRONGRID_TIMEOUT_MS = 12_000;
export const USDT_SCAN_INTERVAL_MS = 20_000;
export const USDT_TRANSFER_PAGE_LIMIT = 50;
export const USDT_MAX_TRANSFER_PAGES = 20;
export const USDT_CREATED_SKEW_MS = 5_000;
export { USDT_FULFILL_GRACE_MINUTES, usdtGraceDeadlineMs };
export { setUsdtFetchForTests } from './usdtRpc.js';
export {
  USDT_NETWORK_IDS,
  USDT_NETWORKS,
  getUsdtNetwork,
  usdtNetworkFromChannel,
  listEnabledUsdtChannels,
};

export class UsdtConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsdtConfigError';
  }
}

export type UsdtAudience = 'buyer' | 'admin';

/** 首次未填写汇率时，后台预填的可改默认值（1 USDT = 多少人民币）。 */
export const DEFAULT_USDT_RATE = '7.20';

export function usdtMissingConfigMessage(audience: UsdtAudience = 'admin'): string {
  const info = inspectUsdtSettings();
  if (audience === 'buyer') {
    return '支付暂不可用，请稍后再试或联系商家';
  }
  if (!info.settings?.enabled) {
    return '尚未启用 USDT 收款，请打开总开关，填写汇率和至少一条链的收款地址并保存';
  }
  return 'USDT 配置不完整：请填写汇率，并至少填写一条收款链的有效地址';
}

export function requireUsdtSettings(audience: UsdtAudience = 'admin'): UsdtSettings {
  const s = loadUsdtSettings();
  if (s && s.enabled && s.rate && USDT_NETWORK_IDS.some((id) => s.networks[id]?.enabled && s.networks[id]?.address)) {
    return s;
  }
  throw new UsdtConfigError(usdtMissingConfigMessage(audience));
}

export function listEnabledUsdtPaymentMethods(): PaymentMethodId[] {
  return listEnabledUsdtChannels().map((id) => usdtChannelFromNetwork(id));
}

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function sha256(buf: Buffer): Buffer {
  return createHash('sha256').update(buf).digest();
}

function base58Decode(s: string): Buffer {
  let num = 0n;
  for (const ch of s) {
    const i = BASE58_ALPHABET.indexOf(ch);
    if (i < 0) throw new Error('invalid base58');
    num = num * 58n + BigInt(i);
  }
  const hex = num.toString(16);
  const padded = hex.length % 2 ? `0${hex}` : hex;
  const bytes = Buffer.from(padded, 'hex');
  let leading = 0;
  for (const ch of s) {
    if (ch === '1') leading += 1;
    else break;
  }
  return Buffer.concat([Buffer.alloc(leading), bytes]);
}

function base58Encode(bytes: Buffer): string {
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros += 1;
  let num = 0n;
  for (const b of bytes) num = (num << 8n) + BigInt(b);
  let out = '';
  while (num > 0n) {
    const rem = Number(num % 58n);
    num = num / 58n;
    out = BASE58_ALPHABET[rem] + out;
  }
  return `${'1'.repeat(zeros)}${out}`;
}

/** 校验波场 TRC20 地址（Base58Check，以 T 开头）。 */
export function isTronAddress(raw: string): boolean {
  const s = raw.trim();
  if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(s)) return false;
  try {
    const bytes = base58Decode(s);
    if (bytes.length !== 25) return false;
    if (bytes[0] !== 0x41) return false;
    const payload = bytes.subarray(0, 21);
    const checksum = bytes.subarray(21);
    const hash = sha256(sha256(payload));
    return hash.subarray(0, 4).equals(checksum);
  } catch {
    return false;
  }
}

export function tronAddressToHex(addr: string): string | null {
  if (!isTronAddress(addr)) return null;
  try {
    return base58Decode(addr.trim()).subarray(0, 21).toString('hex');
  } catch {
    return null;
  }
}

export function tronHexToBase58(hex: string): string | null {
  let h = hex.trim().replace(/^0x/i, '').toLowerCase();
  if (h.length === 40) h = `41${h}`;
  if (!/^[0-9a-f]{42}$/.test(h) || !h.startsWith('41')) return null;
  const payload = Buffer.from(h, 'hex');
  const checksum = sha256(sha256(payload)).subarray(0, 4);
  return base58Encode(Buffer.concat([payload, checksum]));
}

export function normalizeTronAddress(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  if (isTronAddress(s)) return s;
  return tronHexToBase58(s);
}

export function tronAddressesEqual(a: string, b: string): boolean {
  const na = normalizeTronAddress(a);
  const nb = normalizeTronAddress(b);
  return Boolean(na && nb && na === nb);
}

function maskTronAddress(addr: string): string {
  const s = addr.trim();
  if (s.length < 12) return '***';
  return `${s.slice(0, 6)}…${s.slice(-4)}`;
}

function sanitizeUsdtLog(text: string): string {
  return text
    .replace(/TRON-PRO-API-KEY[:\s=]*\S+/gi, 'TRON-PRO-API-KEY=***')
    .replace(/api[_-]?key[:\s=]*\S+/gi, 'api_key=***');
}

/** 规范化汇率（1 USDT = 多少人民币），最多 6 位小数，必须大于 0。 */
export function normalizeUsdtRate(raw: string): string | null {
  const s = String(raw ?? '').trim();
  if (!/^\d+(\.\d{1,6})?$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0.01 || n > 1_000_000) return null;
  return s;
}

export function normalizeExpireMinutes(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isInteger(n) || n < 5 || n > 180) return DEFAULT_USDT_EXPIRE_MINUTES;
  return n;
}

export function isUsdtReceiveAddress(networkId: UsdtNetworkId, raw: string): boolean {
  const def = getUsdtNetwork(networkId);
  const s = raw.trim();
  if (def.addressKind === 'tron') return isTronAddress(s);
  return isEvmAddress(s);
}

export function normalizeUsdtReceiveAddress(networkId: UsdtNetworkId, raw: string): string | null {
  const s = raw.trim();
  if (!isUsdtReceiveAddress(networkId, s)) return null;
  const def = getUsdtNetwork(networkId);
  if (def.addressKind === 'evm') return normalizeEvmAddress(s);
  return s;
}

/**
 * 保存语义：填了该链有效地址即视为开通；打开了开关但没填地址则报错。
 */
export function applyAddressAutoEnable(
  networkId: UsdtNetworkId,
  input: { enabled?: boolean; address?: string },
): { ok: true; enabled: boolean; address: string } | { ok: false; error: string } {
  const def = getUsdtNetwork(networkId);
  const address = (input.address || '').trim();
  if (address && !isUsdtReceiveAddress(networkId, address)) {
    return { ok: false, error: `请填写有效的 ${def.displayNetwork} 收款地址` };
  }
  if (input.enabled && !address) {
    return { ok: false, error: `已打开 ${def.displayNetwork}，请填写该链收款地址` };
  }
  return {
    ok: true,
    enabled: Boolean(address && isUsdtReceiveAddress(networkId, address)),
    address,
  };
}

export type UsdtConfigReport = {
  ok: boolean;
  error?: string;
  message: string;
  ready: Array<{ id: UsdtNetworkId; displayNetwork: string }>;
  issues: string[];
};

export function summarizeUsdtConfig(settings?: UsdtSettings | null): UsdtConfigReport {
  const s = settings ?? loadUsdtSettings();
  const ready: Array<{ id: UsdtNetworkId; displayNetwork: string }> = [];
  const issues: string[] = [];
  if (!s) {
    return {
      ok: false,
      error: usdtMissingConfigMessage('admin'),
      message: '尚未保存 USDT 配置。打开总开关，填写汇率和至少一条链的收款地址并保存即可。',
      ready,
      issues: ['尚未保存 USDT 配置'],
    };
  }
  if (!normalizeUsdtRate(s.rate)) {
    issues.push('请填写有效汇率：1 USDT 等于多少人民币，最少 0.01');
  }
  for (const id of USDT_NETWORK_IDS) {
    const net = s.networks[id];
    const def = getUsdtNetwork(id);
    const addr = (net?.address || '').trim();
    if (net?.enabled && (!addr || !isUsdtReceiveAddress(id, addr))) {
      issues.push(`已打开 ${def.displayNetwork}，请填写该链收款地址`);
      continue;
    }
    if (addr && !isUsdtReceiveAddress(id, addr)) {
      issues.push(`${def.displayNetwork} 收款地址格式不正确`);
      continue;
    }
    if (addr && isUsdtReceiveAddress(id, addr) && net?.enabled) {
      ready.push({ id, displayNetwork: def.displayNetwork });
    }
  }
  const names = ready.map((r) => r.displayNetwork).join('、');
  if (!s.enabled) {
    return {
      ok: false,
      error: '尚未启用 USDT 收款，请打开总开关并保存',
      message: names
        ? `总开关已关闭，买家暂时看不到 USDT。已保存的链：${names}。打开总开关并保存即可对外收款。`
        : '尚未启用 USDT 收款。打开总开关，填写汇率和至少一条链的收款地址并保存即可。',
      ready,
      issues: ['尚未打开「启用 USDT 收款」总开关', ...issues],
    };
  }
  if (!ready.length) {
    const error = issues[0] || '请至少填写一条收款链的有效地址';
    return {
      ok: false,
      error,
      message: issues.length ? issues.join(' ') : error,
      ready,
      issues: issues.length ? issues : [error],
    };
  }
  if (issues.length) {
    return {
      ok: false,
      error: issues[0],
      message: `已填写 ${names}，但仍有问题：${issues.join(' ')}`,
      ready,
      issues,
    };
  }
  return {
    ok: true,
    message: `已开通 USDT 收款：${names}。买家结账时可以选择这些网络。`,
    ready,
    issues: [],
  };
}

export function validateUsdtConfig(settings?: UsdtSettings | null): {
  ok: boolean;
  error?: string;
} {
  const report = summarizeUsdtConfig(settings);
  return report.ok ? { ok: true } : { ok: false, error: report.error || report.message };
}

export function usdtToPoints(raw: string | number): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return Math.round(raw * 10 ** USDT_DECIMALS);
  }
  const s = String(raw).trim();
  const m = s.match(/^(-?)(\d+)(?:\.(\d{1,4}))?$/);
  if (!m) throw new Error(`无效 USDT 金额: ${s}`);
  const sign = m[1] === '-' ? -1 : 1;
  const whole = Number(m[2]);
  const frac = (m[3] ?? '').padEnd(USDT_DECIMALS, '0');
  return sign * (whole * 10 ** USDT_DECIMALS + Number(frac));
}

export function pointsToUsdt(points: number): string {
  if (!Number.isInteger(points)) throw new Error('USDT 精度必须为整数');
  const sign = points < 0 ? '-' : '';
  const n = Math.abs(points);
  const base = 10 ** USDT_DECIMALS;
  return `${sign}${Math.floor(n / base)}.${String(n % base).padStart(USDT_DECIMALS, '0')}`;
}

export function usdtAmountEqual(a: string | number, b: string | number): boolean {
  try {
    return usdtToPoints(a) === usdtToPoints(b);
  } catch {
    return false;
  }
}

export function cnyAmountEqual(a: string | number, b: string | number): boolean {
  try {
    const fa =
      typeof a === 'number' && Number.isFinite(a)
        ? yuanToFen(a.toFixed(2))
        : yuanToFen(String(a).trim());
    const fb =
      typeof b === 'number' && Number.isFinite(b)
        ? yuanToFen(b.toFixed(2))
        : yuanToFen(String(b).trim());
    return fa === fb;
  } catch {
    return false;
  }
}

function rateToMicros(rate: string): bigint {
  const n = normalizeUsdtRate(rate);
  if (!n) throw new Error('无效汇率');
  const [w, f = ''] = n.split('.');
  return BigInt(w) * 1_000_000n + BigInt(f.padEnd(6, '0'));
}

/** 按人民币金额与汇率换算 USDT（四位小数，四舍五入）。 */
export function cnyToUsdtPoints(cny: string, rate: string): number {
  const fen = BigInt(yuanToFen(cny));
  const micros = rateToMicros(rate);
  // usdt_points = round(cny_fen * 1e8 / rate_micros)
  const prod = fen * 100_000_000n;
  const q = (prod + micros / 2n) / micros;
  if (q <= 0n) throw new Error('换算后的 USDT 金额过低');
  if (q > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('USDT 金额过大');
  return Number(q);
}

export function allocateUniqueUsdtAmount(
  basePoints: number,
  occupiedPoints: Iterable<number>,
  maxTries = USDT_MAX_UNIQUE_TRIES,
): number {
  const taken = new Set(occupiedPoints);
  let points = basePoints;
  for (let i = 0; i < maxTries; i += 1) {
    if (!taken.has(points)) return points;
    points += USDT_AMOUNT_STEP_POINTS;
  }
  throw new Error('暂无可用的唯一收款金额，请稍后再试');
}

export function occupiedPointsFromAmounts(amounts: string[]): number[] {
  const out: number[] = [];
  for (const a of amounts) {
    try {
      out.push(usdtToPoints(a));
    } catch {
      /* ignore malformed */
    }
  }
  return out;
}

export function usdtQrContent(address: string, amount?: string, networkId: UsdtNetworkId = 'trc20'): string {
  return buildUsdtQrContent(networkId, address, amount);
}

export function toSqliteUtc(d: Date): string {
  return d.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
}

export type CreatedUsdtPayment = {
  address: string;
  amount: string;
  network: string;
  networkId: UsdtNetworkId;
  standard: string;
  expireAt: string;
  qrContent: string;
};

/** 为待支付订单分配唯一 USDT 金额并写入占用，与预占卡密有效期对齐。 */
export function assignUsdtPayment(
  outTradeNo: string,
  now = new Date(),
): CreatedUsdtPayment {
  const settings = loadUsdtSettings();
  if (!settings?.enabled || !normalizeUsdtRate(settings.rate)) {
    throw new UsdtConfigError(usdtMissingConfigMessage('buyer'));
  }

  const run = getDb().transaction(() => {
    const order = getOrderByOutTradeNo(outTradeNo);
    if (!order) throw new UsdtConfigError('订单不存在');
    if (!isUsdtPaymentChannel(order.payment_channel)) {
      throw new UsdtConfigError('订单不是 USDT 收款');
    }
    const networkId = orderUsdtNetwork(order) || usdtNetworkFromChannel(order.payment_channel);
    if (!networkId || !isUsdtNetworkId(networkId)) {
      throw new UsdtConfigError('不支持的 USDT 收款网络');
    }
    const netCfg = settings.networks[networkId];
    const address = normalizeUsdtReceiveAddress(networkId, netCfg?.address || '');
    if (!netCfg?.enabled || !address) {
      throw new UsdtConfigError(usdtMissingConfigMessage('buyer'));
    }
    const def = getUsdtNetwork(networkId);
    const base = cnyToUsdtPoints(order.total_amount, settings.rate);
    const occupied = occupiedPointsFromAmounts(
      listOccupiedUsdtAmounts(address, now, networkId),
    );
    const unique = allocateUniqueUsdtAmount(base, occupied);
    const amount = pointsToUsdt(unique);
    const expireAt = new Date(
      now.getTime() + settings.expireMinutes * 60_000,
    ).toISOString();
    const qrContent = usdtQrContent(address, amount, networkId);
    updateOrder(outTradeNo, {
      usdt_amount: amount,
      usdt_address: address,
      usdt_expire_at: expireAt,
      usdt_network: networkId,
      qr_code: qrContent,
    });
    const reserveUntil = new Date(
      new Date(expireAt).getTime() + USDT_FULFILL_GRACE_MINUTES * 60_000,
    );
    setOrderReservationUntil(order.id, toSqliteUtc(reserveUntil));
    return {
      address,
      amount,
      network: def.displayNetwork,
      networkId,
      standard: def.standard,
      expireAt,
      qrContent,
    };
  });
  return run.immediate();
}

export function fulfillUsdtOrder(input: {
  outTradeNo: string;
  txHash: string;
  actualAmount: string | number;
  address?: string;
  rawNotify?: string;
}): { ok: true } | { ok: false; reason: string; orderMissing?: boolean } {
  const run = getDb().transaction(() => {
    const order = getOrderByOutTradeNo(input.outTradeNo);
    if (!order) {
      return { ok: false as const, reason: 'order_missing', orderMissing: true };
    }
    if (!isUsdtPaymentChannel(order.payment_channel)) {
      return { ok: false as const, reason: 'not_usdt_order' };
    }
    const txHash = input.txHash.trim();
    if (!txHash) return { ok: false as const, reason: 'tx_missing' };
    if (isPaidStatus(order.status)) {
      if (order.usdt_tx_hash && order.usdt_tx_hash === txHash) {
        return { ok: true as const };
      }
      return { ok: false as const, reason: 'already_paid' };
    }
    if (order.status === 'TRADE_CLOSED' || order.status === 'FAILED') {
      return { ok: false as const, reason: 'order_closed' };
    }
    if (!order.usdt_amount || !usdtAmountEqual(order.usdt_amount, input.actualAmount)) {
      return { ok: false as const, reason: 'usdt_amount_mismatch' };
    }
    const addr = (input.address || '').trim();
    if (order.usdt_address && addr && !usdtReceiveAddressesEqual(order, addr)) {
      return { ok: false as const, reason: 'address_mismatch' };
    }
    const networkId = orderUsdtNetwork(order);
    const dup = getOrderByUsdtTxHash(txHash, networkId);
    if (dup && dup.out_trade_no !== order.out_trade_no) {
      return { ok: false as const, reason: 'tx_reused' };
    }
    markOrderPaidAndDeliverKeys(input.outTradeNo, {
      status: 'TRADE_SUCCESS',
      trade_no: txHash,
      usdt_tx_hash: txHash,
      raw_notify: input.rawNotify,
    });
    return { ok: true as const };
  });
  return run.immediate();
}

export type Trc20Transfer = {
  txHash: string;
  to: string;
  from: string;
  /** 链上整数金额（精度因链而异，BSC 为 18 位，多数为 6 位） */
  valueOnChain: bigint;
  timestampMs: number;
  contract?: string;
  networkId?: UsdtNetworkId;
};

export function parseTrc20Transfers(raw: unknown): Trc20Transfer[] {
  const root =
    raw && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const list = Array.isArray(root.data)
    ? root.data
    : Array.isArray(raw)
      ? raw
      : [];
  const out: Trc20Transfer[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const txHash = String(row.transaction_id || row.txID || row.tx_hash || '').trim();
    const to = String(row.to || '').trim();
    const from = String(row.from || '').trim();
    const valueRaw = String(row.value ?? '').trim();
    const ts = Number(row.block_timestamp ?? row.timestamp ?? 0);
    const token = row.token_info;
    const contract =
      token && typeof token === 'object'
        ? String((token as Record<string, unknown>).address || '').trim()
        : String(row.contract_address || '').trim();
    if (!txHash || !to || !/^\d+$/.test(valueRaw)) continue;
    if (contract && contract !== USDT_TRC20_CONTRACT) continue;
    out.push({
      txHash,
      to,
      from,
      valueOnChain: BigInt(valueRaw),
      timestampMs: Number.isFinite(ts) ? ts : 0,
      contract: contract || undefined,
      networkId: 'trc20',
    });
  }
  return out;
}

/** 4 位小数应付额对应的链上整数值。默认按 6 位小数（Tron/以太坊等）；BSC 需传入 18。 */
export function usdtPointsToOnChain(points4: number, decimals = USDT_ONCHAIN_DECIMALS): bigint {
  return pointsToOnChainDecimals(points4, decimals);
}

export function onChainToUsdtPoints(value: bigint, decimals = USDT_ONCHAIN_DECIMALS): number | null {
  return onChainToPointsDecimals(value, decimals);
}

function parseTimeMs(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const s = raw.trim();
  if (!s) return null;
  const t = Date.parse(s.includes('T') ? s : `${s.replace(' ', 'T')}Z`);
  return Number.isFinite(t) ? t : null;
}

function networkDefForOrder(
  order: Pick<OrderRow, 'usdt_network' | 'payment_channel'>,
) {
  const id = orderUsdtNetwork(order);
  return id && isUsdtNetworkId(id) ? getUsdtNetwork(id) : null;
}

function usdtReceiveAddressesEqual(order: Pick<OrderRow, 'usdt_address' | 'usdt_network' | 'payment_channel'>, other: string): boolean {
  const left = (order.usdt_address || '').trim();
  const right = other.trim();
  if (!left || !right) return false;
  const def = networkDefForOrder(order);
  if (def?.addressKind === 'evm') {
    return evmAddressesEqual(left, right);
  }
  return left === right;
}

export function transferMatchesOrder(
  transfer: Trc20Transfer,
  order: OrderRow,
  shopAddress: string,
  now = new Date(),
): boolean {
  if (!isUsdtPaymentChannel(order.payment_channel)) return false;
  if (isPaidStatus(order.status)) return false;
  const networkId = orderUsdtNetwork(order);
  const def = networkDefForOrder(order);
  if (transfer.networkId && networkId && transfer.networkId !== networkId) return false;
  if (def?.addressKind === 'evm') {
    if (!evmAddressesEqual(transfer.to, shopAddress)) return false;
    if (order.usdt_address && !evmAddressesEqual(order.usdt_address, transfer.to)) return false;
  } else {
    if (transfer.to !== shopAddress) return false;
    if (order.usdt_address && order.usdt_address !== transfer.to) return false;
  }
  if (!order.usdt_amount) return false;
  let points: number;
  try {
    points = usdtToPoints(order.usdt_amount);
  } catch {
    return false;
  }
  const decimals = def?.decimals ?? USDT_ONCHAIN_DECIMALS;
  if (transfer.valueOnChain !== usdtPointsToOnChain(points, decimals)) return false;
  const created = parseTimeMs(order.created_at) ?? 0;
  const expire = parseTimeMs(order.usdt_expire_at);
  // 只按区块时间判断窗口：即使现在已过展示到期，窗口内到账仍应履约。
  if (expire != null && transfer.timestampMs > expire) return false;
  if (created && transfer.timestampMs + USDT_CREATED_SKEW_MS < created) return false;
  void now;
  return true;
}

export function findPendingOrderForTransfer(
  transfer: Trc20Transfer,
  orders: OrderRow[],
  shopAddress: string,
  now = new Date(),
): OrderRow | null {
  const matches = orders.filter((o) =>
    transferMatchesOrder(transfer, o, shopAddress, now),
  );
  if (matches.length !== 1) return null;
  return matches[0];
}

function scanTargetKey(networkId: string, address: string): string {
  return `${networkId}:${address.trim().toLowerCase()}`;
}

export function expireUsdtPendingOrders(
  now = new Date(),
  opts?: { onlyAddresses?: string[]; onlyTargets?: Array<{ network: string; address: string }> },
): number {
  const allow = opts?.onlyTargets
    ? new Set(
        opts.onlyTargets
          .filter((t) => t.network && t.address)
          .map((t) => scanTargetKey(t.network, t.address)),
      )
    : opts?.onlyAddresses
      ? new Set(opts.onlyAddresses.filter(Boolean).map((a) => a.trim().toLowerCase()))
      : null;
  const orders = listExpiredUsdtOrders(now).filter((o) => {
    if (!allow) return true;
    if (!o.usdt_address) return false;
    if (opts?.onlyTargets) {
      const net = orderUsdtNetwork(o);
      if (!net) return false;
      return allow.has(scanTargetKey(net, o.usdt_address));
    }
    return allow.has(o.usdt_address.trim().toLowerCase()) || allow.has(o.usdt_address);
  });
  let n = 0;
  for (const order of orders) {
    if (isPaidStatus(order.status)) continue;
    updateOrder(order.out_trade_no, { status: 'TRADE_CLOSED' });
    releaseReservationsForOrder(order.id);
    n += 1;
  }
  return n;
}

async function trongridGet(
  pathAndQuery: string,
  apiKey?: string,
): Promise<{ ok: boolean; raw: unknown; error?: string }> {
  const url = new URL(pathAndQuery, TRONGRID_BASE).toString();
  const headers: Record<string, string> = { Accept: 'application/json' };
  const key = (apiKey || '').trim();
  if (key) headers['TRON-PRO-API-KEY'] = key;
  return officialHttpsRequest({
    url,
    allowedHosts: [TRONGRID_HOST],
    method: 'GET',
    headers,
    timeoutMs: TRONGRID_TIMEOUT_MS,
  });
}

export function trc20ListFingerprint(raw: unknown): string | undefined {
  const root =
    raw && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const meta =
    root.meta && typeof root.meta === 'object'
      ? (root.meta as Record<string, unknown>)
      : {};
  const direct = String(meta.fingerprint || '').trim();
  if (direct) return direct;
  const links =
    meta.links && typeof meta.links === 'object'
      ? (meta.links as Record<string, unknown>)
      : {};
  const next = String(links.next || '').trim();
  if (!next) return undefined;
  try {
    const u = new URL(next);
    if (u.protocol !== 'https:' || u.hostname !== TRONGRID_HOST) return undefined;
    return u.searchParams.get('fingerprint') || undefined;
  } catch {
    return undefined;
  }
}

function isUsdtContract(addr: string): boolean {
  return !addr || tronAddressesEqual(addr, USDT_TRC20_CONTRACT);
}

function decodeTrc20TransferData(data: string): { to: string; value: bigint } | null {
  const hex = data.trim().replace(/^0x/i, '').toLowerCase();
  if (!hex.startsWith('a9059cbb')) return null;
  const payload = hex.slice(8);
  if (payload.length < 128) return null;
  const to = tronHexToBase58(payload.slice(24, 64));
  if (!to) return null;
  try {
    return { to, value: BigInt(`0x${payload.slice(64, 128)}`) };
  } catch {
    return null;
  }
}

function parseTriggerSmartContractUsdt(item: unknown): Trc20Transfer | null {
  if (!item || typeof item !== 'object') return null;
  const row = item as Record<string, unknown>;
  const ret = Array.isArray(row.ret) ? row.ret[0] : undefined;
  if (ret && typeof ret === 'object') {
    const cr = String((ret as Record<string, unknown>).contractRet || '').toUpperCase();
    if (cr && cr !== 'SUCCESS') return null;
  }
  if (row.confirmed === false) return null;
  const txHash = String(row.txID || row.txid || row.transaction_id || row.tx_hash || '').trim();
  if (!txHash) return null;
  const rawData =
    row.raw_data && typeof row.raw_data === 'object'
      ? (row.raw_data as Record<string, unknown>)
      : {};
  const contracts = Array.isArray(rawData.contract) ? rawData.contract : [];
  const ts = Number(rawData.timestamp ?? row.block_timestamp ?? row.timestamp ?? 0);
  for (const c of contracts) {
    if (!c || typeof c !== 'object') continue;
    const contract = c as Record<string, unknown>;
    const parameter =
      contract.parameter && typeof contract.parameter === 'object'
        ? (contract.parameter as Record<string, unknown>)
        : {};
    const value =
      parameter.value && typeof parameter.value === 'object'
        ? (parameter.value as Record<string, unknown>)
        : contract;
    if (!value || typeof value !== 'object') continue;
    const contractAddr = String(
      (value as Record<string, unknown>).contract_address || '',
    ).trim();
    if (contractAddr && !isUsdtContract(contractAddr)) continue;
    const data = String((value as Record<string, unknown>).data || '').trim();
    const decoded = decodeTrc20TransferData(data);
    if (!decoded) continue;
    const from =
      normalizeTronAddress(String((value as Record<string, unknown>).owner_address || row.from || '')) ||
      '';
    return {
      txHash,
      to: decoded.to,
      from,
      valueOnChain: decoded.value,
      timestampMs: Number.isFinite(ts) ? ts : 0,
      contract: normalizeTronAddress(contractAddr) || USDT_TRC20_CONTRACT,
    };
  }
  return null;
}

/** 解析官方交易详情（或同形 TRC20 列表项）中的 USDT 转入。 */
export function parseUsdtTransferFromTransaction(
  raw: unknown,
  toAddress?: string,
): Trc20Transfer | null {
  const listed = parseTrc20Transfers(raw).filter((t) => {
    if (t.contract && !isUsdtContract(t.contract)) return false;
    if (toAddress && !tronAddressesEqual(t.to, toAddress)) return false;
    return true;
  });
  if (listed.length === 1) return listed[0];
  if (listed.length > 1) {
    const match = toAddress
      ? listed.filter((t) => tronAddressesEqual(t.to, toAddress))
      : listed;
    if (match.length >= 1) return match[0];
  }

  const root =
    raw && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const candidates: unknown[] = [];
  if (Array.isArray(root.data)) candidates.push(...root.data);
  else if (root.txID || root.raw_data) candidates.push(root);
  if (root.transaction && typeof root.transaction === 'object') {
    candidates.push(root.transaction);
  }
  for (const item of candidates) {
    const transfer = parseTriggerSmartContractUsdt(item);
    if (!transfer) continue;
    if (toAddress && !tronAddressesEqual(transfer.to, toAddress)) continue;
    return transfer;
  }
  return null;
}

export async function fetchUsdtTransfers(input: {
  address: string;
  apiKey?: string;
  minTimestampMs?: number;
}): Promise<{ ok: boolean; transfers: Trc20Transfer[]; error?: string }> {
  if (!isTronAddress(input.address)) {
    return { ok: false, transfers: [], error: '收款地址无效' };
  }
  const transfers: Trc20Transfer[] = [];
  const seen = new Set<string>();
  let fingerprint: string | undefined;
  for (let page = 0; page < USDT_MAX_TRANSFER_PAGES; page += 1) {
    const params = new URLSearchParams({
      only_to: 'true',
      only_confirmed: 'true',
      limit: String(USDT_TRANSFER_PAGE_LIMIT),
      contract_address: USDT_TRC20_CONTRACT,
    });
    if (input.minTimestampMs && input.minTimestampMs > 0) {
      params.set('min_timestamp', String(input.minTimestampMs));
    }
    if (fingerprint) params.set('fingerprint', fingerprint);
    const path = `/v1/accounts/${encodeURIComponent(input.address)}/transactions/trc20?${params}`;
    const res = await trongridGet(path, input.apiKey);
    if (!res.ok) return { ok: false, transfers: [], error: res.error };
    const batch = parseTrc20Transfers(res.raw);
    for (const t of batch) {
      if (seen.has(t.txHash)) continue;
      seen.add(t.txHash);
      transfers.push(t);
    }
    const nextFp = trc20ListFingerprint(res.raw);
    const reachedMin =
      Boolean(input.minTimestampMs && input.minTimestampMs > 0) &&
      batch.length > 0 &&
      batch.every(
        (t) => t.timestampMs > 0 && t.timestampMs < (input.minTimestampMs as number),
      );
    if (!nextFp || nextFp === fingerprint || !batch.length || reachedMin) break;
    fingerprint = nextFp;
  }
  return { ok: true, transfers };
}

export async function fetchUsdtTransferByHash(
  address: string,
  txHash: string,
  apiKey?: string,
): Promise<Trc20Transfer | null> {
  const hash = txHash.trim();
  if (!hash || hash.length > 128 || /[^a-zA-Z0-9_-]/.test(hash)) return null;
  const qs = new URLSearchParams({ only_confirmed: 'true', visible: 'true' });
  const path = `/v1/transactions/${encodeURIComponent(hash)}?${qs}`;
  const res = await trongridGet(path, apiKey);
  if (!res.ok) return null;
  const to = isTronAddress(address) ? address : '';
  return parseUsdtTransferFromTransaction(res.raw, to || undefined);
}

export function applyTransferToPendingOrders(
  transfer: Trc20Transfer,
  shopAddress: string,
  now = new Date(),
): { applied: boolean; outTradeNo?: string; reason?: string } {
  const pending = listPendingUsdtOrders();
  const order = findPendingOrderForTransfer(transfer, pending, shopAddress, now);
  if (!order) return { applied: false, reason: 'no_match' };
  const decimals = networkDefForOrder(order)?.decimals ?? USDT_ONCHAIN_DECIMALS;
  const points = onChainToUsdtPoints(transfer.valueOnChain, decimals);
  if (points == null) return { applied: false, reason: 'amount_precision' };
  const result = fulfillUsdtOrder({
    outTradeNo: order.out_trade_no,
    txHash: transfer.txHash,
    actualAmount: pointsToUsdt(points),
    address: transfer.to,
    rawNotify: JSON.stringify({
      txHash: transfer.txHash,
      amount: pointsToUsdt(points),
      to: transfer.to,
    }),
  });
  if (!result.ok) return { applied: false, outTradeNo: order.out_trade_no, reason: result.reason };
  return { applied: true, outTradeNo: order.out_trade_no };
}

export type UsdtScanStatus = {
  ok: boolean;
  at: string;
  error?: string;
  scanned: number;
  applied: number;
  closed?: number;
};

let lastScanStatus: UsdtScanStatus | null = null;
let scanInFlight: Promise<{ scanned: number; applied: number }> | null = null;

export function getUsdtScanStatus(): UsdtScanStatus | null {
  return lastScanStatus;
}

/** 仅测试使用：清空扫描状态与互斥锁。 */
export function resetUsdtScanForTests(): void {
  lastScanStatus = null;
  scanInFlight = null;
}

function recordUsdtScanStatus(status: UsdtScanStatus, addresses?: string[]): void {
  lastScanStatus = status;
  if (status.ok) return;
  const masked = (addresses || []).map(maskTronAddress);
  console.warn(
    '[usdt] 到账查询失败',
    sanitizeUsdtLog(
      JSON.stringify({
        error: status.error,
        addresses: masked,
        at: status.at,
      }),
    ),
  );
}

function savedNetworkApiKey(networkId: UsdtNetworkId): string | undefined {
  const settings = loadUsdtSettings();
  if (!settings) return undefined;
  return settings.networks[networkId]?.apiKey || (networkId === 'trc20' ? settings.apiKey : '') || undefined;
}

function evmTransferToCommon(t: EvmUsdtTransfer): Trc20Transfer {
  return {
    txHash: t.txHash,
    to: t.to,
    from: t.from,
    valueOnChain: t.valueOnChain,
    timestampMs: t.timestampMs,
    contract: t.contract,
    networkId: t.networkId,
  };
}

async function fetchTransfersForNetwork(input: {
  networkId: UsdtNetworkId;
  address: string;
  minTimestampMs?: number;
}): Promise<{ ok: boolean; transfers: Trc20Transfer[]; error?: string }> {
  const def = getUsdtNetwork(input.networkId);
  const apiKey = savedNetworkApiKey(input.networkId);
  if (def.family === 'tron') {
    const fetched = await fetchUsdtTransfers({
      address: input.address,
      apiKey,
      minTimestampMs: input.minTimestampMs,
    });
    return {
      ok: fetched.ok,
      error: fetched.error,
      transfers: fetched.transfers.map((t) => ({ ...t, networkId: 'trc20' })),
    };
  }
  const fetched = await fetchEvmUsdtTransfers({
    def,
    address: input.address,
    apiKey,
    minTimestampMs: input.minTimestampMs,
  });
  return {
    ok: fetched.ok,
    error: fetched.error,
    transfers: fetched.transfers.map(evmTransferToCommon),
  };
}

export async function fetchUsdtChainTransferByHash(input: {
  networkId: UsdtNetworkId;
  address: string;
  txHash: string;
}): Promise<Trc20Transfer | null> {
  const def = getUsdtNetwork(input.networkId);
  const apiKey = savedNetworkApiKey(input.networkId);
  if (def.family === 'tron') {
    const found = await fetchUsdtTransferByHash(input.address, input.txHash, apiKey);
    return found ? { ...found, networkId: 'trc20' } : null;
  }
  const found = await fetchEvmUsdtTransferByHash({
    def,
    address: input.address,
    txHash: input.txHash,
    apiKey,
  });
  return found ? evmTransferToCommon(found) : null;
}

async function doScanUsdtDeposits(now: Date): Promise<{ scanned: number; applied: number }> {
  const settings = loadUsdtSettings();
  const pending = listPendingUsdtOrders();
  if (!pending.length) {
    recordUsdtScanStatus({
      ok: true,
      at: now.toISOString(),
      scanned: 0,
      applied: 0,
      closed: 0,
    });
    return { scanned: 0, applied: 0 };
  }

  const byTarget = new Map<string, { networkId: UsdtNetworkId; address: string; orders: OrderRow[] }>();
  for (const order of pending) {
    const networkId = (orderUsdtNetwork(order) || usdtNetworkFromChannel(order.payment_channel)) as UsdtNetworkId | null;
    if (!networkId || !isUsdtNetworkId(networkId)) continue;
    const rawAddr =
      (order.usdt_address || settings?.networks[networkId]?.address || '').trim();
    const address = normalizeUsdtReceiveAddress(networkId, rawAddr) || rawAddr;
    if (!address || !isUsdtReceiveAddress(networkId, address)) continue;
    const key = scanTargetKey(networkId, address);
    const cur = byTarget.get(key) || { networkId, address, orders: [] };
    cur.orders.push(order);
    byTarget.set(key, cur);
  }

  if (!byTarget.size) {
    recordUsdtScanStatus({
      ok: false,
      at: now.toISOString(),
      error: '待付订单缺少有效收款地址，已跳过关单',
      scanned: 0,
      applied: 0,
    });
    return { scanned: 0, applied: 0 };
  }

  let scanned = 0;
  let applied = 0;
  const failed: string[] = [];
  const succeeded: Array<{ network: string; address: string }> = [];

  for (const target of byTarget.values()) {
    const minTs = target.orders.reduce((min, o) => {
      const t = parseTimeMs(o.created_at);
      if (t == null) return min;
      return min == null ? t : Math.min(min, t);
    }, null as number | null);
    const fetched = await fetchTransfersForNetwork({
      networkId: target.networkId,
      address: target.address,
      minTimestampMs: minTs ? Math.max(0, minTs - USDT_CREATED_SKEW_MS) : undefined,
    });
    if (!fetched.ok) {
      failed.push(target.address);
      continue;
    }
    succeeded.push({ network: target.networkId, address: target.address });
    scanned += fetched.transfers.length;
    for (const transfer of fetched.transfers) {
      const result = applyTransferToPendingOrders(transfer, target.address, now);
      if (result.applied) applied += 1;
    }
  }

  let closed = 0;
  if (succeeded.length) {
    closed = expireUsdtPendingOrders(now, { onlyTargets: succeeded });
  }

  const ok = failed.length === 0;
  recordUsdtScanStatus(
    {
      ok,
      at: now.toISOString(),
      error: ok
        ? undefined
        : '到账查询失败，将在下一轮自动重试。建议为对应链填写查询 API Key 以降低限流风险。',
      scanned,
      applied,
      closed,
    },
    failed,
  );
  return { scanned, applied };
}

export async function scanUsdtDeposits(now = new Date()): Promise<{
  scanned: number;
  applied: number;
}> {
  if (scanInFlight) return scanInFlight;
  scanInFlight = doScanUsdtDeposits(now).finally(() => {
    scanInFlight = null;
  });
  return scanInFlight;
}

export type UsdtNotifyHandleResult = {
  ok: boolean;
  reason: string;
};

function safeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a.toLowerCase());
  const bb = Buffer.from(b.toLowerCase());
  if (ba.length !== bb.length || ba.length === 0) return false;
  return timingSafeEqual(ba, bb);
}

/** 可选通知签名：非空参数按键名排序后 HMAC-SHA256（密钥由服务端派生，不对外展示）。 */
export function usdtNotifySecret(): string {
  return createHash('sha256')
    .update(`jima-usdt-notify:${config.encryptionKey}`, 'utf8')
    .digest('hex');
}

export function signUsdtNotifyParams(params: Record<string, unknown>, secret: string): string {
  const pairs = Object.entries(params)
    .filter(([k]) => k !== 'signature' && k !== 'sign')
    .map(([k, v]) => {
      if (v === undefined || v === null || v === '') return null;
      return [k, String(v)] as const;
    })
    .filter((p): p is readonly [string, string] => p != null)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const payload = pairs.map(([k, v]) => `${k}=${v}`).join('&');
  return createHmac('sha256', secret).update(payload, 'utf8').digest('hex');
}

export function verifyUsdtNotifySign(
  params: Record<string, unknown>,
  secret = usdtNotifySecret(),
): boolean {
  const sign = String(params.signature ?? params.sign ?? '').trim();
  if (!sign) return false;
  return safeEqualHex(sign, signUsdtNotifyParams(params, secret));
}

/**
 * 可选补通知入口。必须提供交易哈希，并满足其一：
 * 链上查到该笔转入且金额精确匹配，或带有有效的服务端签名且金额与本地唯一应付额一致。
 * 仍会拒绝重复交易哈希。不要求当前开关打开（待付订单仍可履约）。
 */
export async function processUsdtNotify(
  params: Record<string, unknown>,
): Promise<UsdtNotifyHandleResult> {
  const settings = loadUsdtSettings();
  const txHash = String(params.tx_hash ?? params.block_transaction_id ?? '').trim();
  if (!txHash) return { ok: false, reason: 'tx_missing' };
  const signed = verifyUsdtNotifySign(params);
  const outTradeNo = String(params.order_id ?? params.out_trade_no ?? '').trim();
  const postedAmount = params.actual_amount ?? params.amount ?? params.usdt_amount;

  const order = outTradeNo ? getOrderByOutTradeNo(outTradeNo) : null;
  const networkHintRaw = String(params.network ?? params.chain ?? '').trim();
  const inferred =
    orderUsdtNetwork(order ?? { usdt_network: null, payment_channel: '' }) ||
    usdtNetworkFromChannel(order?.payment_channel) ||
    (isTronAddress(String(params.address || settings?.address || '')) ? 'trc20' : null);
  const networkId: UsdtNetworkId | null = isUsdtNetworkId(networkHintRaw)
    ? networkHintRaw
    : isUsdtNetworkId(inferred)
      ? inferred
      : null;
  const addressHint =
    (order?.usdt_address || '').trim() ||
    String(params.token ?? params.address ?? '').trim() ||
    (networkId ? settings?.networks[networkId]?.address || '' : '') ||
    (settings?.address || '').trim();

  let transfer = networkId
    ? await fetchUsdtChainTransferByHash({ networkId, address: addressHint, txHash })
    : await fetchUsdtTransferByHash(addressHint, txHash, settings?.apiKey);
  if (!transfer && signed && outTradeNo && postedAmount != null) {
    const result = fulfillUsdtOrder({
      outTradeNo,
      txHash,
      actualAmount: postedAmount as string | number,
      address: addressHint,
      rawNotify: JSON.stringify(params),
    });
    return result.ok
      ? { ok: true, reason: 'applied' }
      : { ok: false, reason: result.reason };
  }
  if (!transfer) return { ok: false, reason: 'tx_not_found' };

  const allowed = new Set(
    listPendingUsdtOrders()
      .map((o) => o.usdt_address)
      .filter((a): a is string => Boolean(a)),
  );
  if (settings?.address) allowed.add(settings.address);
  if (order?.usdt_address) allowed.add(order.usdt_address);
  const addrEq = (a: string, b: string) => {
    const net = networkId || transfer.networkId;
    if (net && getUsdtNetwork(net).addressKind === 'evm') return evmAddressesEqual(a, b);
    return tronAddressesEqual(a, b) || a === b;
  };
  if (allowed.size && ![...allowed].some((a) => addrEq(a, transfer.to))) {
    return { ok: false, reason: 'address_mismatch' };
  }

  const decimals = (networkId || transfer.networkId)
    ? getUsdtNetwork((networkId || transfer.networkId) as UsdtNetworkId).decimals
    : USDT_ONCHAIN_DECIMALS;
  const points = onChainToUsdtPoints(transfer.valueOnChain, decimals);
  if (points == null) return { ok: false, reason: 'amount_precision' };
  const actualAmount = pointsToUsdt(points);
  if (postedAmount != null && !usdtAmountEqual(actualAmount, postedAmount as string | number)) {
    return { ok: false, reason: 'amount_mismatch' };
  }

  if (outTradeNo) {
    const result = fulfillUsdtOrder({
      outTradeNo,
      txHash: transfer.txHash,
      actualAmount,
      address: transfer.to,
      rawNotify: JSON.stringify(params),
    });
    return result.ok
      ? { ok: true, reason: 'applied' }
      : { ok: false, reason: result.reason };
  }

  const applied = applyTransferToPendingOrders(transfer, transfer.to);
  return applied.applied
    ? { ok: true, reason: 'applied' }
    : { ok: false, reason: applied.reason || 'no_match' };
}

let usdtTimer: ReturnType<typeof setInterval> | null = null;

export function startUsdtWatcher(intervalMs = USDT_SCAN_INTERVAL_MS): void {
  if (usdtTimer) return;
  const tick = () => {
    void (async () => {
      try {
        await scanUsdtDeposits();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[usdt] 到账扫描失败', sanitizeUsdtLog(msg));
      }
    })();
  };
  tick();
  usdtTimer = setInterval(tick, intervalMs);
  usdtTimer.unref?.();
}
