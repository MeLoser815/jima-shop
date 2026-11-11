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

export function assertProductionConfig(
  env: NodeJS.ProcessEnv = process.env,
): void {
  if ((env.NODE_ENV ?? 'development') !== 'production') return;
  if (isInsecureSecret(env.SESSION_SECRET)) {
    throw new Error(
      '生产环境必须设置 SESSION_SECRET，且不能使用示例占位值。请在环境变量中配置足够长的随机串。',
    );
  }
  if (isInsecureSecret(env.SETTINGS_ENCRYPTION_KEY)) {
    throw new Error(
      '生产环境必须设置 SETTINGS_ENCRYPTION_KEY，且不能使用示例占位值。请在环境变量中配置足够长的随机串。',
    );
  }
  if (!isPublicHttpsUrl(env.ALIPAY_NOTIFY_URL)) {
    throw new Error(
      '生产环境 ALIPAY_NOTIFY_URL 必须是公网可访问的 HTTPS 地址（不能使用 localhost 或 HTTP）。',
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
