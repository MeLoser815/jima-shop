import { createHash, timingSafeEqual } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import {
  inspectEpaySettings,
  loadEpaySettings,
  type EpaySettings,
} from './db.js';
import {
  isBlockedSsrfHost,
  isPublicHttpUrl,
} from './security.js';
import {
  type EpayChannel,
  isEpayChannel,
  normalizeEpayChannels,
} from './paymentMethods.js';

export const EPAY_REQUEST_TIMEOUT_MS = 15_000;

export class EpayConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EpayConfigError';
  }
}

export type EpayAudience = 'buyer' | 'admin';

export function epayMissingConfigMessage(audience: EpayAudience = 'admin'): string {
  const info = inspectEpaySettings();
  if (audience === 'buyer') {
    return '支付暂不可用，请稍后再试或联系商家';
  }
  if (info.unreadable) {
    return '收款密钥无法读取，请在后台重新保存易支付配置';
  }
  if (!info.settings?.enabled) {
    return '尚未启用易支付，请在管理后台打开开关并填写支付网关、商户ID和商户密钥';
  }
  return '易支付配置不完整：请填写支付网关、商户ID、商户密钥，并至少开通一个渠道';
}

export function requireEpaySettings(audience: EpayAudience = 'admin'): EpaySettings {
  const s = loadEpaySettings();
  if (s && s.enabled && s.gateway && s.pid && s.key && s.channels.length) {
    return s;
  }
  throw new EpayConfigError(epayMissingConfigMessage(audience));
}

/** 规范化商户填写的网关根地址，去掉末尾 mapi.php / api.php / submit.php。 */
export function normalizeEpayGateway(raw: string): string {
  const t = raw.trim();
  if (!t) return '';
  let u: URL;
  try {
    u = new URL(t);
  } catch {
    return t;
  }
  const file = u.pathname.split('/').pop() || '';
  if (/^(mapi|api|submit)\.php$/i.test(file)) {
    u.pathname = u.pathname.slice(0, -file.length);
  }
  let href = u.toString();
  if (!href.endsWith('/')) href += '/';
  return href;
}

export function isSafeEpayGatewayUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const normalized = normalizeEpayGateway(url);
    const u = new URL(normalized);
    if (u.username || u.password) return false;
    if (u.port && !['', '80', '443', '8080', '8443'].includes(u.port)) {
      // still allow other ports on public hosts; only host is SSRF-sensitive
    }
    return isPublicHttpUrl(normalized);
  } catch {
    return false;
  }
}

export function epayEndpoint(gateway: string, file: string): string {
  const base = normalizeEpayGateway(gateway);
  return new URL(file, base).toString();
}

function md5Hex(s: string): string {
  return createHash('md5').update(s, 'utf8').digest('hex');
}

function safeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a.toLowerCase());
  const bb = Buffer.from(b.toLowerCase());
  if (ba.length !== bb.length || ba.length === 0) return false;
  return timingSafeEqual(ba, bb);
}

/**
 * 彩虹易支付 / V1 签名：参数按键名 ASCII 排序，排除 sign、sign_type 和空值，
 * 拼成 k=v&k=v 后直接接商户密钥，再做 MD5 小写。
 * 不会把 undefined 或空值写入签名串。
 */
export function signEpayParams(
  params: Record<string, string | number | undefined | null>,
  key: string,
): string {
  const pairs = Object.entries(params)
    .filter(([k, v]) => {
      if (k === 'sign' || k === 'sign_type') return false;
      if (v === undefined || v === null) return false;
      return String(v) !== '';
    })
    .map(([k, v]) => [k, String(v)] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const payload = pairs.map(([k, v]) => `${k}=${v}`).join('&') + key;
  return md5Hex(payload);
}

export function verifyEpaySign(
  params: Record<string, string>,
  key: string,
): boolean {
  const sign = String(params.sign || '').trim();
  if (!sign) return false;
  return safeEqualHex(sign, signEpayParams(params, key));
}

export function collectEpayParams(
  source: Record<string, unknown> | null | undefined,
): Record<string, string> {
  const params: Record<string, string> = {};
  for (const [k, v] of Object.entries(source ?? {})) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) {
      if (v[0] === undefined || v[0] === null) continue;
      params[k] = String(v[0]);
      continue;
    }
    params[k] = String(v);
  }
  return params;
}

export type EpayCreateParamsInput = {
  pid: string;
  type: EpayChannel;
  outTradeNo: string;
  name: string;
  money: string;
  clientIp?: string;
  device?: string;
  notifyUrl?: string;
  returnUrl?: string;
  key: string;
};

/** 组装 mapi.php 下单参数；未给出的 notify_url / return_url 不会出现在参数或签名中。 */
export function buildEpayCreateParams(
  input: EpayCreateParamsInput,
): Record<string, string> {
  const params: Record<string, string> = {
    pid: input.pid,
    type: input.type,
    out_trade_no: input.outTradeNo,
    name: input.name,
    money: input.money,
    sign_type: 'MD5',
  };
  const clientIp = (input.clientIp || '').trim();
  if (clientIp) params.clientip = clientIp;
  const device = (input.device || '').trim();
  if (device) params.device = device;
  const notifyUrl = (input.notifyUrl || '').trim();
  if (notifyUrl) params.notify_url = notifyUrl;
  const returnUrl = (input.returnUrl || '').trim();
  if (returnUrl) params.return_url = returnUrl;
  params.sign = signEpayParams(params, input.key);
  return params;
}

export function validateEpayConfig(settings?: EpaySettings | null): {
  ok: boolean;
  error?: string;
} {
  const s = settings ?? loadEpaySettings();
  if (!s || !s.enabled) {
    return { ok: false, error: epayMissingConfigMessage('admin') };
  }
  if (!s.gateway || !isSafeEpayGatewayUrl(s.gateway)) {
    return {
      ok: false,
      error: '支付网关地址不合法，请填写可公网访问的 http 或 https 地址，不能使用内网或本机地址',
    };
  }
  if (!/^[A-Za-z0-9_\-]{1,64}$/.test(s.pid.trim())) {
    return { ok: false, error: '商户ID格式不正确' };
  }
  if (!s.key.trim()) {
    return { ok: false, error: '请填写商户密钥' };
  }
  if (!normalizeEpayChannels(s.channels).length) {
    return { ok: false, error: '请至少开通一个收款渠道' };
  }
  return { ok: true };
}

export type EpayCreateResult = {
  ok: boolean;
  code?: string;
  msg?: string;
  tradeNo?: string;
  payUrl?: string;
  qrCode?: string;
  urlScheme?: string;
  raw: Record<string, unknown>;
};

export type EpayQueryResult = {
  ok: boolean;
  msg?: string;
  tradeStatus?: string;
  tradeNo?: string;
  outTradeNo?: string;
  money?: string;
  pid?: string;
  type?: string;
  raw: Record<string, unknown>;
};

async function assertResolvesToPublicAddress(url: string): Promise<void> {
  if (!isSafeEpayGatewayUrl(url) && !isPublicHttpUrl(url)) {
    throw new EpayConfigError('支付网关地址不合法');
  }
  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    throw new EpayConfigError('支付网关地址不合法');
  }
  if (isBlockedSsrfHost(hostname)) {
    throw new EpayConfigError('支付网关地址不合法');
  }
  let addresses: Array<{ address: string }>;
  try {
    addresses = await lookup(hostname, { all: true });
  } catch {
    throw new EpayConfigError('支付网关无法解析，请检查地址是否填写正确');
  }
  if (!addresses.length) {
    throw new EpayConfigError('支付网关无法解析，请检查地址是否填写正确');
  }
  for (const a of addresses) {
    if (isBlockedSsrfHost(a.address)) {
      throw new EpayConfigError('支付网关地址不合法');
    }
  }
}

async function epayFetch(
  url: string,
  init: RequestInit,
): Promise<Response> {
  await assertResolvesToPublicAddress(url);
  return fetch(url, {
    ...init,
    redirect: 'manual',
    signal: AbortSignal.timeout(EPAY_REQUEST_TIMEOUT_MS),
  });
}

function asRecord(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  return { value: raw };
}

function pickStr(
  raw: Record<string, unknown>,
  ...keys: string[]
): string | undefined {
  for (const k of keys) {
    const v = raw[k];
    if (v === undefined || v === null) continue;
    const s = String(v).trim();
    if (s) return s;
  }
  return undefined;
}

export function parseEpayCreateResult(raw: Record<string, unknown>): EpayCreateResult {
  const code = pickStr(raw, 'code');
  const ok = code === '1';
  const payUrl = pickStr(raw, 'payurl', 'pay_url', 'payUrl');
  const qrCode = pickStr(raw, 'qrcode', 'qr_code', 'qrCode');
  const urlScheme = pickStr(raw, 'urlscheme', 'url_scheme', 'urlScheme');
  return {
    ok,
    code,
    msg: pickStr(raw, 'msg', 'message'),
    tradeNo: pickStr(raw, 'trade_no', 'tradeNo'),
    payUrl,
    qrCode,
    urlScheme,
    raw,
  };
}

export function qrOrPayContent(result: EpayCreateResult): string | undefined {
  return result.qrCode || result.payUrl || result.urlScheme || undefined;
}

/**
 * 查单结果：status=1 或 trade_status=TRADE_SUCCESS 视为已支付。
 */
export function parseEpayQueryResult(raw: Record<string, unknown>): EpayQueryResult {
  const code = pickStr(raw, 'code');
  const ok = code === '1';
  const statusRaw = pickStr(raw, 'status', 'trade_status', 'tradeStatus');
  const paid =
    statusRaw === '1' ||
    statusRaw === 'TRADE_SUCCESS' ||
    statusRaw === 'TRADE_FINISHED';
  const tradeStatus = paid
    ? 'TRADE_SUCCESS'
    : statusRaw === 'TRADE_CLOSED' || statusRaw === '-1'
      ? 'TRADE_CLOSED'
      : statusRaw
        ? 'WAIT_BUYER_PAY'
        : undefined;
  return {
    ok,
    msg: pickStr(raw, 'msg', 'message'),
    tradeStatus,
    tradeNo: pickStr(raw, 'trade_no', 'tradeNo'),
    outTradeNo: pickStr(raw, 'out_trade_no', 'outTradeNo'),
    money: pickStr(raw, 'money', 'total_amount', 'totalAmount'),
    pid: pickStr(raw, 'pid'),
    type: pickStr(raw, 'type'),
    raw,
  };
}

export function epayCreateFailureMessage(
  result: EpayCreateResult,
  opts?: { insecureHttp?: boolean },
): string {
  const raw = result.msg || '生成收款码失败，请稍后重试';
  if (opts?.insecureHttp && /notify_url|通知|https/i.test(raw)) {
    return `${raw}。当前不是通过 HTTPS 访问，支付结果将通过页面查单确认。`;
  }
  return raw;
}

export async function epayCreate(
  input: {
    type: EpayChannel;
    outTradeNo: string;
    name: string;
    money: string;
    clientIp?: string;
    device?: string;
    notifyUrl?: string;
    returnUrl?: string;
    audience?: EpayAudience;
  },
): Promise<EpayCreateResult> {
  const audience = input.audience ?? 'admin';
  const settings = requireEpaySettings(audience);
  if (!settings.channels.includes(input.type)) {
    throw new EpayConfigError(
      audience === 'buyer'
        ? '该支付方式暂不可用，请选择其他方式或联系商家'
        : `尚未开通渠道：${input.type}`,
    );
  }
  if (!isEpayChannel(input.type)) {
    throw new EpayConfigError('不支持的支付渠道');
  }
  const params = buildEpayCreateParams({
    pid: settings.pid,
    type: input.type,
    outTradeNo: input.outTradeNo,
    name: input.name,
    money: input.money,
    clientIp: input.clientIp,
    device: input.device || 'pc',
    notifyUrl: input.notifyUrl,
    returnUrl: input.returnUrl,
    key: settings.key,
  });
  const url = epayEndpoint(settings.gateway, 'mapi.php');
  try {
    const body = new URLSearchParams(params);
    const res = await epayFetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      },
      body,
    });
    const text = await res.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return {
        ok: false,
        msg: '支付网关返回无法解析，请检查网关地址是否正确',
        raw: { status: res.status, body: text.slice(0, 500) },
      };
    }
    return parseEpayCreateResult(asRecord(parsed));
  } catch (err) {
    if (err instanceof EpayConfigError) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    if (/aborted|timeout|TimeoutError/i.test(msg)) {
      return { ok: false, msg: '连接支付网关超时，请稍后重试', raw: { error: msg } };
    }
    return { ok: false, msg: `连接支付网关失败：${msg}`, raw: { error: msg } };
  }
}

export async function epayQuery(outTradeNo: string): Promise<EpayQueryResult> {
  const settings = requireEpaySettings('admin');
  const url = new URL(epayEndpoint(settings.gateway, 'api.php'));
  url.searchParams.set('act', 'order');
  url.searchParams.set('pid', settings.pid);
  url.searchParams.set('key', settings.key);
  url.searchParams.set('out_trade_no', outTradeNo);
  try {
    const res = await epayFetch(url.toString(), { method: 'GET' });
    const text = await res.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return {
        ok: false,
        msg: '支付网关返回无法解析',
        raw: { status: res.status, body: text.slice(0, 500) },
      };
    }
    return parseEpayQueryResult(asRecord(parsed));
  } catch (err) {
    if (err instanceof EpayConfigError) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, msg: `查单失败：${msg}`, raw: { error: msg } };
  }
}

export function buyerReturnUrl(
  origin: string | undefined,
  outTradeNo: string,
): string | undefined {
  const o = (origin || '').trim().replace(/\/$/, '');
  if (!o) return undefined;
  try {
    const u = new URL(`${o}/order`);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return undefined;
    u.searchParams.set('no', outTradeNo);
    return u.toString();
  } catch {
    return undefined;
  }
}

export function requestOrigin(req: {
  protocol: string;
  hostname?: string;
  headers: Record<string, unknown>;
  fallbackOrigin?: string;
}): string | undefined {
  const protoRaw = firstHeader(req.headers, 'x-forwarded-proto') || req.protocol || '';
  const proto = protoRaw.split(',')[0].trim().replace(/:$/, '');
  const host = (
    firstHeader(req.headers, 'x-forwarded-host') ||
    firstHeader(req.headers, 'host') ||
    req.hostname ||
    ''
  )
    .split(',')[0]
    .trim();
  if (proto && host && (proto === 'http' || proto === 'https')) {
    return `${proto}://${host}`;
  }
  const fallback = (req.fallbackOrigin || '').trim().replace(/\/$/, '');
  return fallback || undefined;
}

function firstHeader(
  headers: Record<string, unknown>,
  name: string,
): string {
  const raw = headers[name];
  if (Array.isArray(raw)) return String(raw[0] ?? '');
  return raw == null ? '' : String(raw);
}
