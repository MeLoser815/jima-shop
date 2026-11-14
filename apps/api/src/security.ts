import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

export const DEV_SESSION_SECRET_FALLBACK = 'change-me-session-secret-please!!';
export const DEV_ENCRYPTION_KEY_FALLBACK = 'change-me-32-char-secret-key!!';

const PLACEHOLDER_SECRETS = new Set([
  DEV_SESSION_SECRET_FALLBACK,
  DEV_ENCRYPTION_KEY_FALLBACK,
]);

export function isInsecureSecret(value: string | undefined): boolean {
  if (!value || !value.trim()) return true;
  return PLACEHOLDER_SECRETS.has(value.trim());
}

/** 拒绝内网、本机、链路本地和云元数据地址，防止 SSRF。 */
export function isBlockedSsrfHost(host: string | undefined): boolean {
  if (!host) return true;
  const h = host.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!h) return true;
  if (
    h === 'localhost' ||
    h === '::1' ||
    h === '0.0.0.0' ||
    h === '::' ||
    h === 'metadata' ||
    h === 'metadata.google.internal' ||
    h.endsWith('.local') ||
    h.endsWith('.localhost') ||
    h.endsWith('.internal')
  ) {
    return true;
  }
  if (h.includes('%')) return true; // IPv6 zone id
  // IPv4-mapped IPv6, e.g. ::ffff:10.0.0.1
  const mapped = h.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isBlockedSsrfHost(mapped[1]);
  if (isBlockedIpv4(h) || isBlockedIpv6(h)) return true;
  return false;
}

function isBlockedIpv4(host: string): boolean {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const oct = m.slice(1).map((s) => Number(s));
  if (oct.some((n) => n > 255)) return true;
  const [a, b] = oct;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a >= 224) return true; // multicast / reserved
  return false;
}

function isBlockedIpv6(host: string): boolean {
  if (!host.includes(':')) return false;
  const compact = host.replace(/\s/g, '');
  if (compact === '::1' || compact === '::') return true;
  // unique local fc00::/7, link-local fe80::/10
  const first = expandIpv6FirstHextet(compact);
  if (first == null) return true;
  if ((first & 0xfe00) === 0xfc00) return true;
  if ((first & 0xffc0) === 0xfe80) return true;
  if (first === 0) return true; // ::, ::1, and other ::/8
  return false;
}

function expandIpv6FirstHextet(host: string): number | null {
  if (host.startsWith('::')) return 0;
  const first = host.split(':')[0];
  if (!/^[0-9a-f]{1,4}$/i.test(first)) return null;
  return Number.parseInt(first, 16);
}

/** 公网 http(s) URL。禁止 file / 内网 / localhost / 元数据地址。 */
export function isPublicHttpUrl(
  url: string | undefined,
  opts?: { httpsOnly?: boolean },
): boolean {
  if (!url) return false;
  try {
    const u = new URL(url);
    if (opts?.httpsOnly) {
      if (u.protocol !== 'https:') return false;
    } else if (u.protocol !== 'https:' && u.protocol !== 'http:') {
      return false;
    }
    return !isBlockedSsrfHost(u.hostname);
  } catch {
    return false;
  }
}

export function isPublicHttpsUrl(url: string | undefined): boolean {
  return isPublicHttpUrl(url, { httpsOnly: true });
}

/** 根据当前访问地址生成异步通知 URL。仅在公网 HTTPS 时返回。 */
export function buildAutoNotifyUrl(
  protocol: string,
  hostHeader: string | undefined,
  pathname = '/api/payment/notify',
): string | undefined {
  const host = (hostHeader ?? '').trim().split('/')[0].split(',')[0].trim();
  if (!host) return undefined;
  const proto = protocol.toLowerCase().replace(/:$/, '').split(',')[0].trim();
  if (proto !== 'https') return undefined;
  const path = pathname.startsWith('/') ? pathname : `/${pathname}`;
  const url = `https://${host}${path}`;
  return isPublicHttpsUrl(url) ? url : undefined;
}

export function buildAutoEpayNotifyUrl(
  protocol: string,
  hostHeader: string | undefined,
): string | undefined {
  return buildAutoNotifyUrl(protocol, hostHeader, '/api/payment/epay/notify');
}

export type RequestAccess = {
  protocol: string;
  host: string;
  notifyUrl?: string;
  epayNotifyUrl?: string;
  /** 公网 HTTP（非 localhost）访问，无法自动登记异步回调 */
  insecureHttp: boolean;
};

export const INSECURE_HTTP_PAY_HINT =
  '当前不是通过 HTTPS 域名访问。请改用店铺的 HTTPS 地址打开后再支付，否则可能无法生成收款码。';

function firstHeader(
  headers: Record<string, unknown>,
  name: string,
): string {
  const raw = headers[name];
  if (Array.isArray(raw)) return String(raw[0] ?? '');
  return raw == null ? '' : String(raw);
}

export function isLocalHostname(hostHeader: string | undefined): boolean {
  const host = (hostHeader ?? '').trim().split('/')[0].split(',')[0].trim();
  const hostname = host.split(':')[0].replace(/^\[|\]$/g, '').toLowerCase();
  return (
    !hostname ||
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname === '0.0.0.0' ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.localhost')
  );
}

export function isInsecurePublicHttp(
  protocol: string,
  hostHeader: string | undefined,
): boolean {
  const proto = protocol.toLowerCase().replace(/:$/, '').split(',')[0].trim();
  if (proto === 'https') return false;
  return !isLocalHostname(hostHeader);
}

/** 从反代后的请求中识别协议、主机，并在公网 HTTPS 时拼回调地址。 */
export function requestAccessFromRequest(req: {
  protocol: string;
  hostname?: string;
  headers: Record<string, unknown>;
}): RequestAccess {
  const proto = (
    firstHeader(req.headers, 'x-forwarded-proto') ||
    req.protocol ||
    ''
  )
    .split(',')[0]
    .trim();
  const host = (
    firstHeader(req.headers, 'x-forwarded-host') ||
    firstHeader(req.headers, 'host') ||
    req.hostname ||
    ''
  )
    .split(',')[0]
    .trim();
  return {
    protocol: proto,
    host,
    notifyUrl: buildAutoNotifyUrl(proto, host),
    epayNotifyUrl: buildAutoEpayNotifyUrl(proto, host),
    insecureHttp: isInsecurePublicHttp(proto, host),
  };
}

export function notifyUrlFromRequest(req: {
  protocol: string;
  hostname?: string;
  headers: Record<string, unknown>;
}): string | undefined {
  return requestAccessFromRequest(req).notifyUrl;
}


export function shouldSeedSampleData(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if ((env.NODE_ENV ?? 'development') === 'production') return false;
  if (env.JIMA_SEED_DEMO === '0' || env.JIMA_SEED_DEMO === 'false') return false;
  return true;
}

const RUNTIME_SECRETS_FILE = '.runtime-secrets';

function parseRuntimeSecretsFile(file: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!fs.existsSync(file)) return out;
  const raw = fs.readFileSync(file, 'utf8');
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i <= 0) continue;
    out[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
  return out;
}

function writeRuntimeSecretsFile(file: string, values: Record<string, string>): void {
  const body =
    Object.entries(values)
      .map(([k, v]) => `${k}=${v}`)
      .join('\n') + '\n';
  fs.writeFileSync(file, body, { mode: 0o600 });
  fs.chmodSync(file, 0o600);
}

/**
 * 生产环境若未提供 SESSION_SECRET / SETTINGS_ENCRYPTION_KEY，
 * 则在数据目录生成并持久化随机密钥，以便 `docker compose up` 无需先填写密钥即可启动。
 * 已在环境变量中给出的非占位值优先；占位值不会被写入或采用。
 */
export function applyPersistedProductionSecrets(
  dataDir: string,
  env: NodeJS.ProcessEnv = process.env,
): void {
  if ((env.NODE_ENV ?? 'development') !== 'production') return;
  fs.mkdirSync(dataDir, { recursive: true });
  const file = path.join(dataDir, RUNTIME_SECRETS_FILE);
  const stored = parseRuntimeSecretsFile(file);
  let dirty = false;

  const adopt = (key: 'SESSION_SECRET' | 'SETTINGS_ENCRYPTION_KEY') => {
    const fromEnv = env[key]?.trim();
    if (fromEnv && !isInsecureSecret(fromEnv)) {
      env[key] = fromEnv;
      return;
    }
    const fromFile = stored[key]?.trim();
    if (fromFile && !isInsecureSecret(fromFile)) {
      env[key] = fromFile;
      return;
    }
    const generated = randomBytes(32).toString('hex');
    env[key] = generated;
    stored[key] = generated;
    dirty = true;
  };

  adopt('SESSION_SECRET');
  adopt('SETTINGS_ENCRYPTION_KEY');
  if (dirty) writeRuntimeSecretsFile(file, stored);
}

export function assertProductionConfig(
  env: NodeJS.ProcessEnv = process.env,
): void {
  if ((env.NODE_ENV ?? 'development') !== 'production') return;
  if (isInsecureSecret(env.SESSION_SECRET)) {
    throw new Error(
      '生产环境的 SESSION_SECRET 不能使用示例占位值。请改用随机串，或删除该变量以便自动生成并写入数据目录。',
    );
  }
  if (isInsecureSecret(env.SETTINGS_ENCRYPTION_KEY)) {
    throw new Error(
      '生产环境的 SETTINGS_ENCRYPTION_KEY 不能使用示例占位值。请改用随机串，或删除该变量以便自动生成并写入数据目录。',
    );
  }
  const notify = env.ALIPAY_NOTIFY_URL?.trim();
  if (notify && !isPublicHttpsUrl(notify)) {
    throw new Error(
      '若设置 ALIPAY_NOTIFY_URL，必须是公网可访问的 HTTPS 地址（不能使用 localhost 或 HTTP）。',
    );
  }
}

/** 封面图只允许 http(s) 或安全的相对路径（以单斜杠开头）。 */
export function sanitizeCoverUrl(url: string | undefined | null): string {
  const t = (url ?? '').trim();
  if (!t) return '';
  if (/^https?:\/\//i.test(t)) {
    try {
      const u = new URL(t);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') {
        throw new Error('封面图地址不合法');
      }
      return t;
    } catch {
      throw new Error('封面图地址不合法');
    }
  }
  if (t.startsWith('/') && !t.startsWith('//') && !t.includes('\\')) {
    if (/[\s<>'"]/.test(t) || t.includes('..')) {
      throw new Error('封面图地址不合法');
    }
    return t;
  }
  throw new Error('封面图仅支持 http(s) 链接或站点内相对路径');
}

export const CARD_IMPORT_MAX_CHARS = 200_000;
