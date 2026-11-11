import type { FastifyInstance, FastifyRequest } from 'fastify';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { config } from '../config.js';
import { logAudit, listAuditLogs } from '../audit.js';
import {
  AdminSetupError,
  createFirstAdminUser,
  getAdminByUsername,
  getDashboardStats,
  loadAlipaySettings,
  saveAlipaySettings,
  settingsConfigured,
  listOrdersWithItems,
  needsAdminSetup,
  revokeAdminSession,
  revokeAdminSessionsForUser,
  updateAdminPassword,
} from '../db.js';
import { attachKeysToOrders, fulfillPendingOrder } from '../cardKeys.js';
import { issueAdminAuth, requireAdmin } from '../middleware/auth.js';
import { maskSecret } from '../utils/crypto.js';
import { isPublicHttpsUrl } from '../security.js';

const settingsSchema = z.object({
  appId: z.string().min(1, 'AppId 不能为空'),
  privateKey: z.string().optional().default(''),
  alipayPublicKey: z.string().optional().default(''),
  gateway: z.string().url().optional().or(z.literal('')),
  storeId: z.string().optional(),
  sellerId: z.string().optional(),
  notifyUrl: z.string().url().optional().or(z.literal('')),
});

const usernameSchema = z
  .string()
  .trim()
  .min(3, '用户名至少 3 位')
  .max(64, '用户名过长')
  .regex(/^[a-zA-Z0-9_\-\u4e00-\u9fa5]+$/, '用户名含非法字符');

const newPasswordSchema = z.string().min(8, '密码至少 8 位').max(128, '密码过长');

const setupSchema = z.object({
  username: usernameSchema,
  password: newPasswordSchema,
});

const loginSchema = z.object({
  username: usernameSchema,
  password: z.string().min(1, '请输入密码').max(128, '密码过长'),
});

const LOGIN_DUMMY_HASH = bcrypt.hashSync('jima-timing-dummy', 12);

async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

function clientIp(req: FastifyRequest): string | undefined {
  return req.ip;
}

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/admin/bootstrap', async () => ({
    ok: true,
    needsSetup: needsAdminSetup(),
  }));

  app.post(
    '/api/admin/setup',
    { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
    async (req, reply) => {
      if (!needsAdminSetup()) {
        return reply
          .code(409)
          .send({ ok: false, error: '管理员已存在，请直接登录' });
      }
      const parsed = setupSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({
          ok: false,
          error: parsed.error.issues.map((i) => i.message).join('; '),
        });
      }
      const { username, password } = parsed.data;
      try {
        const passwordHash = await hashPassword(password);
        const user = createFirstAdminUser(username, passwordHash);
        const { token } = issueAdminAuth(user.username, user.password_version);
        logAudit({
          actor: user.username,
          action: 'admin.setup',
          ip: clientIp(req),
        });
        return { ok: true, token, username: user.username };
      } catch (err) {
        if (err instanceof AdminSetupError) {
          return reply
            .code(409)
            .send({ ok: false, error: '管理员已存在，请直接登录' });
        }
        throw err;
      }
    },
  );

  app.post(
    '/api/admin/login',
    { config: { rateLimit: { max: 8, timeWindow: '1 minute' } } },
    async (req, reply) => {
      if (needsAdminSetup()) {
        return reply.code(403).send({
          ok: false,
          error: '尚未初始化管理员，请先完成首次设置',
          needsSetup: true,
        });
      }
      const parsed = loginSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({
          ok: false,
          error: parsed.error.issues.map((i) => i.message).join('; '),
        });
      }
      const { username, password } = parsed.data;
      const user = getAdminByUsername(username);
      const match = await bcrypt.compare(
        password,
        user?.password_hash ?? LOGIN_DUMMY_HASH,
      );
      if (!user || !match) {
        logAudit({
          actor: username,
          action: 'admin.login_failed',
          ip: clientIp(req),
        });
        return reply.code(401).send({ ok: false, error: '用户名或密码错误' });
      }
      const { token } = issueAdminAuth(user.username, user.password_version);
      logAudit({
        actor: user.username,
        action: 'admin.login',
        ip: clientIp(req),
      });
      return { ok: true, token, username: user.username };
    },
  );

  app.post(
    '/api/admin/logout',
    { preHandler: requireAdmin },
    async (req) => {
      if (req.adminJti) revokeAdminSession(req.adminJti);
      logAudit({
        actor: req.adminUsername || 'admin',
        action: 'admin.logout',
        ip: clientIp(req),
      });
      return { ok: true };
    },
  );

  app.post(
    '/api/admin/change-password',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const parsed = z
        .object({
          currentPassword: z.string().min(1),
          newPassword: newPasswordSchema,
        })
        .safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({
          ok: false,
          error: parsed.error.issues.map((i) => i.message).join('; '),
        });
      }
      const username = req.adminUsername!;
      const user = getAdminByUsername(username);
      if (!user) {
        return reply.code(401).send({ ok: false, error: '账号不存在' });
      }
      const match = await bcrypt.compare(
        parsed.data.currentPassword,
        user.password_hash,
      );
      if (!match) {
        return reply.code(401).send({ ok: false, error: '当前密码不正确' });
      }
      const passwordHash = await hashPassword(parsed.data.newPassword);
      updateAdminPassword(username, passwordHash);
      revokeAdminSessionsForUser(username);
      logAudit({
        actor: username,
        action: 'admin.change_password',
        ip: clientIp(req),
      });
      return { ok: true, needRelogin: true };
    },
  );

  app.get(
    '/api/admin/me',
    { preHandler: requireAdmin },
    async (req) => ({
      ok: true,
      username: req.adminUsername,
    }),
  );

  app.get(
    '/api/admin/settings',
    { preHandler: requireAdmin },
    async () => {
      const s = loadAlipaySettings();
      if (!s) {
        return {
          ok: true,
          configured: false,
          settings: {
            appId: '',
            privateKeyMasked: '',
            alipayPublicKeyMasked: '',
            gateway: config.gateway,
            storeId: '',
            sellerId: '',
            notifyUrl: config.notifyUrl,
          },
        };
      }
      return {
        ok: true,
        configured: true,
        settings: {
          appId: s.appId,
          privateKeyMasked: maskSecret(s.privateKey),
          alipayPublicKeyMasked: maskSecret(s.alipayPublicKey),
          gateway: s.gateway,
          storeId: s.storeId,
          sellerId: s.sellerId,
          notifyUrl: s.notifyUrl,
        },
      };
    },
  );

  app.put(
    '/api/admin/settings',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const parsed = settingsSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({
          ok: false,
          error: parsed.error.issues.map((i) => i.message).join('; '),
        });
      }
      const d = parsed.data;
      const existing = loadAlipaySettings();
      const privateKey = d.privateKey.trim() || existing?.privateKey || '';
      const alipayPublicKey =
        d.alipayPublicKey.trim() || existing?.alipayPublicKey || '';
      if (!privateKey || privateKey.length < 32) {
        return reply
          .code(400)
          .send({ ok: false, error: '应用私钥不能为空' });
      }
      if (!alipayPublicKey || alipayPublicKey.length < 32) {
        return reply
          .code(400)
          .send({ ok: false, error: '支付宝公钥不能为空' });
      }
      const notifyUrl = (d.notifyUrl || config.notifyUrl || '').trim();
      if (
        config.nodeEnv === 'production' &&
        notifyUrl &&
        !isPublicHttpsUrl(notifyUrl)
      ) {
        return reply.code(400).send({
          ok: false,
          error:
            '异步通知 URL 必须是公网可访问的 HTTPS 地址，不能使用 localhost 或 HTTP。',
        });
      }
      saveAlipaySettings({
        appId: d.appId,
        privateKey,
        alipayPublicKey,
        gateway: d.gateway || config.gateway,
        storeId: d.storeId || '',
        sellerId: d.sellerId || '',
        notifyUrl,
      });
      logAudit({
        actor: req.adminUsername || 'admin',
        action: 'settings.update',
        detail: {
          appId: d.appId,
          gateway: d.gateway || config.gateway,
          notifyUrl,
          sellerId: d.sellerId || '',
        },
        ip: clientIp(req),
      });
      return { ok: true, configured: true };
    },
  );

  app.get(
    '/api/admin/status',
    { preHandler: requireAdmin },
    async () => ({
      ok: true,
      configured: settingsConfigured(),
      gateway: loadAlipaySettings()?.gateway ?? config.gateway,
      notifyUrl: loadAlipaySettings()?.notifyUrl ?? config.notifyUrl,
    }),
  );

  app.get(
    '/api/admin/orders',
    { preHandler: requireAdmin },
    async (req) => {
      const q = req.query as { limit?: string };
      const limit = Math.min(Number(q.limit ?? 50) || 50, 200);
      return { ok: true, orders: attachKeysToOrders(listOrdersWithItems(limit)) };
    },
  );

  app.post(
    '/api/admin/orders/:outTradeNo/fulfill',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const { outTradeNo } = req.params as { outTradeNo: string };
      try {
        const result = fulfillPendingOrder(outTradeNo.trim());
        logAudit({
          actor: req.adminUsername || 'admin',
          action: 'order.fulfill',
          detail: {
            outTradeNo: outTradeNo.trim(),
            added: result.added,
            assigned: result.assigned,
            fulfillmentStatus: result.fulfillmentStatus,
          },
          ip: clientIp(req),
        });
        return { ok: true, ...result };
      } catch (err) {
        const message = err instanceof Error ? err.message : '补发失败';
        return reply.code(400).send({ ok: false, error: message });
      }
    },
  );

  app.get(
    '/api/admin/audit',
    { preHandler: requireAdmin },
    async (req) => {
      const q = req.query as { limit?: string };
      const limit = Math.min(Number(q.limit ?? 100) || 100, 500);
      return { ok: true, logs: listAuditLogs(limit) };
    },
  );

  app.get(
    '/api/admin/dashboard',
    { preHandler: requireAdmin },
    async () => {
      const stats = getDashboardStats();
      return {
        ok: true,
        stats,
        configured: settingsConfigured(),
      };
    },
  );
}
