import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { normalizeAdminBasePath } from './adminPath.js';
import {
  applyPersistedProductionSecrets,
  DEV_ENCRYPTION_KEY_FALLBACK,
  DEV_SESSION_SECRET_FALLBACK,
} from './security.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// 优先加载 apps/api/.env，其次仓库根 .env
dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const isProd = (process.env.NODE_ENV ?? 'development') === 'production';

const databasePath = path.resolve(
  process.env.DATABASE_PATH ??
    path.resolve(__dirname, '../../../data/jima.db'),
);

if (isProd) {
  applyPersistedProductionSecrets(path.dirname(databasePath));
}

export const config = {
  port: Number(process.env.PORT ?? 8001),
  host: process.env.HOST ?? '0.0.0.0',
  /** 可选：仅首次无管理员时用于自动创建账号 */
  bootstrapAdminUsername: process.env.ADMIN_USERNAME?.trim() || '',
  bootstrapAdminPassword: process.env.ADMIN_PASSWORD?.trim() || '',
  /** HMAC 会话签名密钥。生产环境可自动生成并写入数据目录。 */
  sessionSecret:
    process.env.SESSION_SECRET ||
    (isProd
      ? ''
      : process.env.SETTINGS_ENCRYPTION_KEY || DEV_SESSION_SECRET_FALLBACK),
  encryptionKey:
    process.env.SETTINGS_ENCRYPTION_KEY ||
    (isProd ? '' : DEV_ENCRYPTION_KEY_FALLBACK),
  databasePath,
  notifyUrl:
    process.env.ALIPAY_NOTIFY_URL ??
    (isProd ? '' : 'http://localhost:8001/api/payment/notify'),
  gateway:
    process.env.ALIPAY_GATEWAY ?? 'https://openapi.alipay.com/gateway.do',
  webOrigin:
    process.env.WEB_ORIGIN ?? (isProd ? '' : 'http://localhost:5173'),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  /** 环境变量中的后台路径（若设置则锁定，优先于后台保存的值）。 */
  adminBasePath: normalizeAdminBasePath(process.env.ADMIN_BASE_PATH, {
    strict: true,
  }),
};
