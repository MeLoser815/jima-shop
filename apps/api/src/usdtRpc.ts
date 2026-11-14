import { lookup } from 'node:dns/promises';
import { isBlockedSsrfHost } from './security.js';

export const USDT_RPC_TIMEOUT_MS = 12_000;

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

let usdtFetchImpl: FetchLike = fetch;
let skipPublicDnsCheck = false;

/** 仅测试使用：注入官方查询请求实现。 */
export function setUsdtFetchForTests(fn: FetchLike | null): void {
  usdtFetchImpl = fn ?? fetch;
  skipPublicDnsCheck = Boolean(fn);
}

export function getUsdtFetch(): FetchLike {
  return usdtFetchImpl;
}

export function shouldSkipUsdtDnsCheck(): boolean {
  return skipPublicDnsCheck;
}

export function sanitizeUsdtLog(text: string): string {
  return text
    .replace(/TRON-PRO-API-KEY[:\s=]*\S+/gi, 'TRON-PRO-API-KEY=***')
    .replace(/Authorization[:\s=]*\S+/gi, 'Authorization=***')
    .replace(/api[_-]?key[:\s=]*\S+/gi, 'api_key=***');
}

export async function assertOfficialHttpsUrl(
  url: string,
  allowedHosts: readonly string[],
): Promise<URL> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new Error('查询地址不合法');
  }
  const allowed = new Set(allowedHosts.map((h) => h.toLowerCase()));
  if (u.protocol !== 'https:' || !allowed.has(u.hostname.toLowerCase()) || u.username || u.password) {
    throw new Error('查询地址不合法');
  }
  if (isBlockedSsrfHost(u.hostname)) {
    throw new Error('查询地址不合法');
  }
  if (skipPublicDnsCheck) return u;
  let addresses: Array<{ address: string }>;
  try {
    addresses = await lookup(u.hostname, { all: true });
  } catch {
    throw new Error('到账查询服务暂时无法解析');
  }
  if (!addresses.length) throw new Error('到账查询服务暂时无法解析');
  for (const a of addresses) {
    if (isBlockedSsrfHost(a.address)) {
      throw new Error('查询地址不合法');
    }
  }
  return u;
}

export async function officialHttpsRequest(input: {
  url: string;
  allowedHosts: readonly string[];
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
}): Promise<{ ok: boolean; raw: unknown; error?: string; status?: number }> {
  const url = input.url;
  try {
    await assertOfficialHttpsUrl(url, input.allowedHosts);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, raw: {}, error: msg };
  }
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(input.headers || {}),
  };
  try {
    const res = await usdtFetchImpl(url, {
      method: input.method || 'GET',
      headers,
      body: input.body,
      redirect: 'manual',
      signal: AbortSignal.timeout(input.timeoutMs ?? USDT_RPC_TIMEOUT_MS),
    });
    if (res.status >= 300 && res.status < 400) {
      return { ok: false, raw: {}, error: '查询被重定向，已拒绝', status: res.status };
    }
    const text = await res.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return {
        ok: false,
        raw: { body: text.slice(0, 400) },
        error: '查询结果无法解析',
        status: res.status,
      };
    }
    if (!res.ok) {
      return {
        ok: false,
        raw: parsed,
        error: `查询失败（HTTP ${res.status}）`,
        status: res.status,
      };
    }
    return { ok: true, raw: parsed, status: res.status };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, raw: { error: msg }, error: `到账查询失败：${sanitizeUsdtLog(msg)}` };
  }
}
