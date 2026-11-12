import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import formbody from '@fastify/formbody';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import bcrypt from 'bcryptjs';
import { injectAdminBasePath } from './adminPath.js';
import { config } from './config.js';
import { assertProductionConfig } from './security.js';
import { createFirstAdminUser, getAdminBasePath, getDb, needsAdminSetup } from './db.js';
import { startReservationReleaser } from './cardKeys.js';
import { adminRoutes } from './routes/admin.js';
import { paymentRoutes } from './routes/payment.js';
import { productRoutes } from './routes/products.js';
import { storeRoutes } from './routes/store.js';
import { categoryRoutes } from './routes/categories.js';
import { themeRoutes } from './routes/theme.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webDist = path.resolve(__dirname, '../../web/dist');

async function maybeBootstrapAdmin(): Promise<void> {
  if (!needsAdminSetup()) return;
  const u = config.bootstrapAdminUsername;
  const p = config.bootstrapAdminPassword;
  if (!u || !p) return;
  if (u.length < 3 || p.length < 8) {
    console.warn(
      '[bootstrap] ADMIN_USERNAME / ADMIN_PASSWORD 不符合要求（密码至少 8 位），跳过自动创建',
    );
    return;
  }
  const hash = await bcrypt.hash(p, 12);
  createFirstAdminUser(u, hash);
  console.info(
    `[bootstrap] 已用环境变量创建管理员「${u}」，建议随后在后台修改密码并移除 ADMIN_PASSWORD`,
  );
}

async function main() {
  assertProductionConfig();
  getDb();
  await maybeBootstrapAdmin();
  startReservationReleaser();

  const app = Fastify({
    logger: {
      level: config.nodeEnv === 'production' ? 'info' : 'debug',
    },
  });

  await app.register(helmet, {
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    strictTransportSecurity: config.nodeEnv === 'production',
  });

  const origins =
    config.nodeEnv === 'production'
      ? config.webOrigin
        ? [config.webOrigin]
        : true
      : [
          ...new Set([
            config.webOrigin,
            'http://localhost:5173',
            'http://127.0.0.1:5173',
          ]),
        ];
  await app.register(cors, {
    origin: origins,
    credentials: true,
  });
  await app.register(formbody);
  await app.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: '1 minute',
  });

  app.get('/api/health', async () => ({
    ok: true,
    service: 'jima-shop',
    time: new Date().toISOString(),
  }));

  await app.register(adminRoutes);
  await app.register(paymentRoutes);
  await app.register(productRoutes);
  await app.register(storeRoutes);
  await app.register(categoryRoutes);
  await app.register(themeRoutes);

  if (config.nodeEnv === 'production') {
    const indexFile = path.join(webDist, 'index.html');
    if (fs.existsSync(indexFile)) {
      await app.register(fastifyStatic, {
        root: webDist,
        prefix: '/',
        wildcard: false,
        index: false,
      });
      const sendSpaIndex = (reply: { type: (t: string) => { send: (b: string) => unknown } }) => {
        const html = fs.readFileSync(indexFile, 'utf8');
        return reply
          .type('text/html; charset=utf-8')
          .send(injectAdminBasePath(html, getAdminBasePath()));
      };
      app.setNotFoundHandler((req, reply) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          return reply.code(404).send({ ok: false, error: 'Not Found' });
        }
        const url = req.raw.url || '';
        if (url.startsWith('/api/')) {
          return reply.code(404).send({ ok: false, error: 'Not Found' });
        }
        return sendSpaIndex(reply);
      });
    } else {
      app.log.warn(
        { webDist },
        '生产模式未找到前端构建产物，请先运行 pnpm build',
      );
    }
  }

  await app.listen({ port: config.port, host: config.host });
  app.log.info(`API 已启动 http://${config.host}:${config.port}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
