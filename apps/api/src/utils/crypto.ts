import crypto from 'node:crypto';

const ALGO = 'aes-256-gcm';

/** 从任意长度口令派生 32 字节密钥 */
function deriveKey(secret: string): Buffer {
  return crypto.createHash('sha256').update(secret, 'utf8').digest();
}

/** 加密明文，返回 base64(iv:tag:cipher) */
export function encrypt(plain: string, secret: string): string {
  const key = deriveKey(secret);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

/** 解密 encrypt 的结果 */
export function decrypt(payload: string, secret: string): string {
  const buf = Buffer.from(payload, 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const data = buf.subarray(28);
  const key = deriveKey(secret);
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString(
    'utf8',
  );
}

/**
 * 管理端会话 token：base64url(ts.username.jti.passwordVersion.sig)
 * sig = HMAC-SHA256(sessionSecret, `${ts}.${username}.${jti}.${passwordVersion}`)
 */
export function createAdminToken(
  sessionSecret: string,
  username: string,
  jti: string,
  passwordVersion: number,
): string {
  const ts = Date.now().toString();
  const payload = `${ts}.${username}.${jti}.${passwordVersion}`;
  const sig = crypto
    .createHmac('sha256', sessionSecret)
    .update(payload)
    .digest('hex');
  return Buffer.from(`${payload}.${sig}`).toString('base64url');
}

export function verifyAdminToken(
  token: string,
  sessionSecret: string,
  maxAgeMs = 7 * 24 * 3600 * 1000,
):
  | { ok: true; username: string; jti: string; passwordVersion: number }
  | { ok: false } {
  try {
    const raw = Buffer.from(token, 'base64url').toString('utf8');
    const parts = raw.split('.');
    if (parts.length !== 5) return { ok: false };
    const [ts, username, jti, ver, sig] = parts;
    if (!ts || !username || !jti || !ver || !sig) return { ok: false };
    const age = Date.now() - Number(ts);
    if (!Number.isFinite(age) || age < 0 || age > maxAgeMs) return { ok: false };
    const passwordVersion = Number(ver);
    if (!Number.isInteger(passwordVersion) || passwordVersion < 1) {
      return { ok: false };
    }
    const expect = crypto
      .createHmac('sha256', sessionSecret)
      .update(`${ts}.${username}.${jti}.${passwordVersion}`)
      .digest('hex');
    const a = Buffer.from(sig);
    const b = Buffer.from(expect);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return { ok: false };
    }
    return { ok: true, username, jti, passwordVersion };
  } catch {
    return { ok: false };
  }
}

function rawPrivateKeyBody(key: string): string {
  return key
    .trim()
    .replace(/\\n/g, '\n')
    .replace(/-----BEGIN [^-]+-----/g, '')
    .replace(/-----END [^-]+-----/g, '')
    .replace(/\s+/g, '');
}

/**
 * 识别应用私钥格式。支付宝开放平台常见为 PKCS8（BEGIN PRIVATE KEY，
 * 裸密钥多以 MIIEv 开头）；传统 PKCS1 为 BEGIN RSA PRIVATE KEY。
 */
export function detectPrivateKeyType(key: string): 'PKCS1' | 'PKCS8' {
  const trimmed = key.trim().replace(/\\n/g, '\n');
  if (/BEGIN RSA PRIVATE KEY/.test(trimmed)) return 'PKCS1';
  if (/BEGIN PRIVATE KEY/.test(trimmed)) return 'PKCS8';
  const raw = rawPrivateKeyBody(trimmed);
  if (/^MIIEv|^MIGH|^MC4CAQAw/.test(raw)) return 'PKCS8';
  return 'PKCS1';
}

/** 规范化 PEM：无头尾时按识别到的格式补上头尾 */
export function normalizePrivateKey(key: string): string {
  const trimmed = key.trim().replace(/\\n/g, '\n');
  if (trimmed.includes('BEGIN')) return trimmed;
  if (detectPrivateKeyType(trimmed) === 'PKCS8') {
    return `-----BEGIN PRIVATE KEY-----\n${trimmed}\n-----END PRIVATE KEY-----`;
  }
  return `-----BEGIN RSA PRIVATE KEY-----\n${trimmed}\n-----END RSA PRIVATE KEY-----`;
}

export function normalizePublicKey(key: string): string {
  const trimmed = key.trim().replace(/\\n/g, '\n');
  if (trimmed.includes('BEGIN')) return trimmed;
  return `-----BEGIN PUBLIC KEY-----\n${trimmed}\n-----END PUBLIC KEY-----`;
}

export function maskSecret(value: string | null | undefined): string {
  if (!value) return '';
  if (value.length <= 8) return '****';
  return `${value.slice(0, 4)}****${value.slice(-4)}`;
}
