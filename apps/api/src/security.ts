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

export function isPublicHttpsUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return false;
    const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '::1' ||
      host === '0.0.0.0' ||
      host.endsWith('.local') ||
      host.endsWith('.localhost')
    ) {
      return false;
    }
    if (/^10\.\d+\.\d+\.\d+$/.test(host)) return false;
    if (/^192\.168\.\d+\.\d+$/.test(host)) return false;
    if (/^172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+$/.test(host)) return false;
    if (/^169\.254\.\d+\.\d+$/.test(host)) return false;
    return true;
  } catch {
    return false;
  }
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
