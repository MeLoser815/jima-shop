import {
  evmAddressesEqual,
  normalizeEvmAddress,
  officialRpcHosts,
  usdtContracts,
  type UsdtNetworkDef,
  type UsdtNetworkId,
} from './usdtChains.js';
import { officialHttpsRequest, USDT_RPC_TIMEOUT_MS } from './usdtRpc.js';

export const ERC20_TRANSFER_TOPIC =
  '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

export type EvmUsdtTransfer = {
  networkId: UsdtNetworkId;
  txHash: string;
  to: string;
  from: string;
  valueOnChain: bigint;
  timestampMs: number;
  contract: string;
  blockNumber: number;
};

function topicAddress(topic: string): string | null {
  const hex = topic.trim().replace(/^0x/i, '').toLowerCase();
  if (hex.length < 40) return null;
  return normalizeEvmAddress(`0x${hex.slice(-40)}`);
}

function parseHexBigInt(raw: string): bigint | null {
  const s = String(raw || '').trim();
  if (!s) return null;
  try {
    if (/^0x[0-9a-fA-F]+$/.test(s)) return BigInt(s);
    if (/^\d+$/.test(s)) return BigInt(s);
    return null;
  } catch {
    return null;
  }
}

function parseHexNumber(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) return Math.floor(raw);
  const s = String(raw ?? '').trim();
  if (!s) return null;
  const n = s.startsWith('0x') || s.startsWith('0X') ? Number.parseInt(s, 16) : Number(s);
  return Number.isFinite(n) ? n : null;
}

function isAcceptedContract(def: UsdtNetworkDef, contract: string): boolean {
  return usdtContracts(def).some((c) => evmAddressesEqual(c, contract));
}

function toHex(n: number): string {
  return `0x${Math.max(0, Math.floor(n)).toString(16)}`;
}

function authHeaders(apiKey?: string): Record<string, string> {
  const key = (apiKey || '').trim();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (key) headers.Authorization = `Bearer ${key}`;
  return headers;
}

export async function evmRpcCall(
  def: UsdtNetworkDef,
  method: string,
  params: unknown[],
  apiKey?: string,
): Promise<{ ok: boolean; result?: unknown; error?: string }> {
  let lastError = '查询失败';
  const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method, params });
  for (const endpoint of def.rpc) {
    const res = await officialHttpsRequest({
      url: endpoint.url,
      allowedHosts: officialRpcHosts(def),
      method: 'POST',
      headers: authHeaders(apiKey),
      body,
      timeoutMs: USDT_RPC_TIMEOUT_MS,
    });
    if (!res.ok) {
      lastError = res.error || lastError;
      continue;
    }
    const root = res.raw && typeof res.raw === 'object' ? (res.raw as Record<string, unknown>) : {};
    if (root.error) {
      const err = root.error as Record<string, unknown>;
      lastError = String(err.message || err.code || 'RPC 错误');
      continue;
    }
    if (!('result' in root)) {
      lastError = '查询结果无法解析';
      continue;
    }
    return { ok: true, result: root.result };
  }
  return { ok: false, error: lastError };
}

export function parseEvmUsdtTransfers(input: {
  logs: unknown;
  def: UsdtNetworkDef;
  toAddress?: string;
  timestampByBlock?: Map<number, number>;
}): EvmUsdtTransfer[] {
  const list = Array.isArray(input.logs) ? input.logs : [];
  const out: EvmUsdtTransfer[] = [];
  const wantedTo = input.toAddress ? normalizeEvmAddress(input.toAddress) : null;
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const contract = String(row.address || '').trim();
    if (!isAcceptedContract(input.def, contract)) continue;
    const topics = Array.isArray(row.topics) ? row.topics.map((t) => String(t)) : [];
    if (!topics[0] || topics[0].toLowerCase() !== ERC20_TRANSFER_TOPIC) continue;
    const from = topics[1] ? topicAddress(topics[1]) || '' : '';
    const to = topics[2] ? topicAddress(topics[2]) : null;
    if (!to) continue;
    if (wantedTo && !evmAddressesEqual(to, wantedTo)) continue;
    const value = parseHexBigInt(String(row.data ?? ''));
    if (value == null) continue;
    const txHash = String(row.transactionHash || row.transaction_hash || row.hash || '').trim();
    if (!txHash) continue;
    const blockNumber = parseHexNumber(row.blockNumber ?? row.block_number) ?? 0;
    const tsRaw = row.timeStamp ?? row.timestamp ?? row.blockTimestamp ?? row.block_timestamp;
    let timestampMs = 0;
    if (tsRaw != null) {
      const ts = parseHexNumber(tsRaw);
      if (ts != null) timestampMs = ts > 10_000_000_000 ? ts : ts * 1000;
    }
    if (!timestampMs && input.timestampByBlock && blockNumber) {
      timestampMs = input.timestampByBlock.get(blockNumber) ?? 0;
    }
    out.push({
      networkId: input.def.id,
      txHash,
      to,
      from,
      valueOnChain: value,
      timestampMs,
      contract: normalizeEvmAddress(contract) || contract,
      blockNumber,
    });
  }
  return out;
}

async function evmLatestBlock(def: UsdtNetworkDef, apiKey?: string): Promise<number | null> {
  const res = await evmRpcCall(def, 'eth_blockNumber', [], apiKey);
  if (!res.ok) return null;
  return parseHexNumber(res.result);
}

async function evmBlockTimestamp(
  def: UsdtNetworkDef,
  blockNumber: number,
  apiKey?: string,
  cache?: Map<number, number>,
): Promise<number> {
  if (cache?.has(blockNumber)) return cache.get(blockNumber)!;
  const res = await evmRpcCall(def, 'eth_getBlockByNumber', [toHex(blockNumber), false], apiKey);
  if (!res.ok || !res.result || typeof res.result !== 'object') return 0;
  const ts = parseHexNumber((res.result as Record<string, unknown>).timestamp);
  const ms = ts == null ? 0 : ts > 10_000_000_000 ? ts : ts * 1000;
  cache?.set(blockNumber, ms);
  return ms;
}

export async function fetchEvmUsdtTransfers(input: {
  def: UsdtNetworkDef;
  address: string;
  apiKey?: string;
  minTimestampMs?: number;
}): Promise<{ ok: boolean; transfers: EvmUsdtTransfer[]; error?: string }> {
  const to = normalizeEvmAddress(input.address);
  if (!to) return { ok: false, transfers: [], error: '收款地址无效' };
  const latest = await evmLatestBlock(input.def, input.apiKey);
  if (latest == null) return { ok: false, transfers: [], error: '无法获取最新区块' };
  const confirmedTo = Math.max(0, latest - input.def.confirmations);
  if (confirmedTo <= 0) return { ok: true, transfers: [] };

  const windowMs = input.minTimestampMs
    ? Math.max(60_000, Date.now() - input.minTimestampMs)
    : 3_600_000;
  const lookback = Math.ceil((windowMs * 2) / input.def.blockTimeMs) + 64;
  const fromBlock = Math.max(0, confirmedTo - lookback);
  const chunk = Math.max(1, input.def.logChunkBlocks || 2_000);
  const topicTo = `0x${to.slice(2).padStart(64, '0')}`;
  const contracts = usdtContracts(input.def);
  const logs: unknown[] = [];

  for (let start = fromBlock; start <= confirmedTo; start += chunk) {
    const end = Math.min(confirmedTo, start + chunk - 1);
    const res = await evmRpcCall(
      input.def,
      'eth_getLogs',
      [
        {
          fromBlock: toHex(start),
          toBlock: toHex(end),
          address: contracts.length === 1 ? contracts[0] : contracts,
          topics: [ERC20_TRANSFER_TOPIC, null, topicTo],
        },
      ],
      input.apiKey,
    );
    if (!res.ok) return { ok: false, transfers: [], error: res.error || '查询转入失败' };
    if (Array.isArray(res.result)) logs.push(...res.result);
  }

  const uniqueBlocks = new Set<number>();
  const parsedWithoutTs = parseEvmUsdtTransfers({ logs, def: input.def, toAddress: to });
  for (const t of parsedWithoutTs) {
    if (!t.timestampMs && t.blockNumber) uniqueBlocks.add(t.blockNumber);
  }
  const cache = new Map<number, number>();
  for (const block of uniqueBlocks) {
    await evmBlockTimestamp(input.def, block, input.apiKey, cache);
  }
  const transfers = parseEvmUsdtTransfers({
    logs,
    def: input.def,
    toAddress: to,
    timestampByBlock: cache,
  }).filter((t) => !input.minTimestampMs || t.timestampMs === 0 || t.timestampMs >= input.minTimestampMs);
  return { ok: true, transfers };
}

export async function fetchEvmUsdtTransferByHash(input: {
  def: UsdtNetworkDef;
  address: string;
  txHash: string;
  apiKey?: string;
}): Promise<EvmUsdtTransfer | null> {
  const hash = input.txHash.trim();
  if (!hash || hash.length > 128 || /[^a-zA-Z0-9_-]/.test(hash)) return null;
  const prefixed = hash.startsWith('0x') || hash.startsWith('0X') ? hash : `0x${hash}`;
  const receipt = await evmRpcCall(input.def, 'eth_getTransactionReceipt', [prefixed], input.apiKey);
  if (!receipt.ok || !receipt.result || typeof receipt.result !== 'object') return null;
  const row = receipt.result as Record<string, unknown>;
  if (row.status && String(row.status).toLowerCase() !== '0x1') return null;
  const latest = await evmLatestBlock(input.def, input.apiKey);
  const blockNumber = parseHexNumber(row.blockNumber) ?? 0;
  if (latest != null && blockNumber > 0 && latest - blockNumber < input.def.confirmations) {
    return null;
  }
  const tsCache = new Map<number, number>();
  if (blockNumber) await evmBlockTimestamp(input.def, blockNumber, input.apiKey, tsCache);
  const parsed = parseEvmUsdtTransfers({
    logs: row.logs,
    def: input.def,
    toAddress: input.address,
    timestampByBlock: tsCache,
  });
  return parsed[0] ?? null;
}
