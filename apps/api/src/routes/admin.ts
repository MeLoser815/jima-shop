import type { FastifyInstance, FastifyRequest } from 'fastify';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { config } from '../config.js';
import {
  getAuditLogRetentionDays,
  listAuditLogs,
  logAudit,
  normalizeAuditPage,
  normalizeAuditPageSize,
  setAuditLogRetentionDays,
} from '../audit.js';
import {
  AdminSetupError,
  createFirstAdminUser,
  getAdminByUsername,
  getDashboardStats,
  inspectAlipaySettings,
  inspectEpaySettings,
  inspectUsdtSettings,
  loadAlipaySettings,
  loadEpaySettings,
  loadPaymentMethodLabels,
  paymentConfigured,
  saveAlipaySettings,
  saveEpaySettings,
  savePaymentMethodLabels,
  saveUsdtSettings,
  settingsConfigured,
  epayConfigured,
  usdtConfigured,
  needsAdminSetup,
  normalizeAdminListPage,
  normalizeAdminListPageSize,
  queryAdminOrders,
  type AdminOrderFulfillment,
  type AdminOrderPayStatus,
  type AdminOrderSortBy,
  revokeAdminSession,
  revokeAdminSessionsForUser,
  updateAdminPassword,
  getAdminBasePath,
  isAdminBasePathEnvLocked,
  updateAdminBasePath,
  AdminBasePathError,
} from '../db.js';
import { attachKeysToOrders, fulfillPendingOrder } from '../cardKeys.js';
import { issueAdminAuth, requireAdmin } from '../middleware/auth.js';
import { validateAlipayConfig } from '../alipay.js';
import { normalizeEpayGateway, validateEpayConfig, isSafeEpayGatewayUrl } from '../epay.js';
import { maskSecret } from '../utils/crypto.js';
import { isPublicHttpsUrl } from '../security.js';
import { normalizeEpayChannels, PAYMENT_LABEL_MAX_LEN } from '../paymentMethods.js';
import {
  applyAddressAutoEnable,
  isUsdtReceiveAddress,
  normalizeExpireMinutes,
  normalizeUsdtRate,
  summarizeUsdtConfig,
  getUsdtScanStatus,
} from '../usdt.js';
import { USDT_NETWORK_LIST, isUsdtNetworkId, type UsdtNetworkId } from '../usdtChains.js';

const paymentLabelsSchema = z.record(z.string().max(PAYMENT_LABEL_MAX_LEN * 2)).optional();

const settingsSchema = z.object({
  appId: z.string().min(1, 'AppId 不能为空'),
  privateKey: z.string().optional().default(''),
  alipayPublicKey: z.string().optional().default(''),
  gateway: z.string().url().optional().or(z.literal('')),
  storeId: z.string().optional(),
  sellerId: z.string().optional(),
  notifyUrl: z.string().url().optional().or(z.literal('')),
  paymentMethodLabels: paymentLabelsSchema,
});

const epaySettingsSchema = z.object({
  enabled: z.boolean(),
  gateway: z.string().max(512).optional().default(''),
  pid: z.string().max(64).optional().default(''),
  key: z.string().max(128).optional().default(''),
  channels: z.array(z.string()).optional().default([]),
  paymentMethodLabels: paymentLabelsSchema,
});

const usdtSettingsSchema = z.object({
  enabled: z.boolean(),
  address: z.string().max(80).optional().default(''),
  rate: z.string().max(32).optional().default(''),
  expireMinutes: z.number().int().optional(),
  apiKey: z.string().max(128).optional().default(''),
  networks: z
    .array(
      z.object({
        id: z.string(),
        enabled: z.boolean(),
        address: z.string().max(80).optional().default(''),
        apiKey: z.string().max(128).optional().default(''),
      }),
    )
    .optional(),
  paymentMethodLabels: paymentLabelsSchema,
});


function usdtAdminPayload() {
  const usdtInfo = inspectUsdtSettings();
  const usdtSettings = usdtInfo.settings;
  const scan = getUsdtScanStatus();
  const networks = USDT_NETWORK_LIST.map((def) => {
    const n = usdtSettings?.networks[def.id];
    return {
      id: def.id,
      channel: def.channel,
      name: def.name,
      displayNetwork: def.displayNetwork,
      standard: def.standard,
      decimals: def.decimals,
      defaultLabel: def.defaultLabel,
      enabled: Boolean(n?.enabled),
      address: n?.address || '',
      apiKeyMasked: n?.apiKey ? maskSecret(n.apiKey) : '',
    };
  });
  return {
    enabled: usdtInfo.enabled,
    configured: usdtInfo.configured,
    unreadable: usdtInfo.unreadable,
    settings: {
      address: usdtSettings?.address || '',
      rate: usdtSettings?.rate || '',
      expireMinutes: usdtSettings?.expireMinutes ?? 15,
      apiKeyMasked: usdtSettings?.apiKey ? maskSecret(usdtSettings.apiKey) : '',
      networks,
    },
    scanStatus: scan
      ? {
          ok: scan.ok,
          at: scan.at,
          error: scan.error,
          scanned: scan.scanned,
          applied: scan.applied,
        }
      : null,
  };
}

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
    '/api/admin/admin-path',
    { preHandler: requireAdmin },
    async () => ({
      ok: true,
      path: getAdminBasePath(),
      envLocked: isAdminBasePathEnvLocked(),
    }),
  );

  app.put(
    '/api/admin/admin-path',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const parsed = z
        .object({ path: z.string().min(1, '请填写后台路径') })
        .safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({
          ok: false,
          error: parsed.error.issues.map((i) => i.message).join('; '),
        });
      }
      try {
        const path = updateAdminBasePath(parsed.data.path);
        logAudit({
          actor: req.adminUsername || 'admin',
          action: 'admin.change_path',
          detail: { path },
          ip: clientIp(req),
        });
        return { ok: true, path, envLocked: false };
      } catch (err) {
        const message = err instanceof Error ? err.message : '后台路径无效';
        if (err instanceof AdminBasePathError || /ADMIN_BASE_PATH|保留路径|根路径|必须是单个路径段/.test(message)) {
          return reply.code(400).send({ ok: false, error: message });
        }
        throw err;
      }
    },
  );

  app.get(
    '/api/admin/settings',
    { preHandler: requireAdmin },
    async () => {
      const info = inspectAlipaySettings();
      const s = info.settings;
      const epayInfo = inspectEpaySettings();
      const epaySettings = epayInfo.settings;
      const epay = {
        enabled: epayInfo.enabled,
        configured: epayInfo.configured,
        unreadable: epayInfo.unreadable,
        settings: {
          gateway: epaySettings?.gateway || '',
          pid: epaySettings?.pid || '',
          keyMasked: epaySettings?.key ? maskSecret(epaySettings.key) : '',
          channels: epaySettings?.channels ?? [],
        },
      };
      const usdt = usdtAdminPayload();
      const paymentMethodLabels = loadPaymentMethodLabels();
      if (!s) {
        return {
          ok: true,
          configured: false,
          unreadable: info.unreadable,
          paymentConfigured: paymentConfigured(),
          settings: {
            appId: info.appId,
            privateKeyMasked: '',
            alipayPublicKeyMasked: '',
            gateway: config.gateway,
            storeId: '',
            sellerId: '',
            notifyUrl: config.notifyUrl,
          },
          epay,
          usdt,
          paymentMethodLabels,
        };
      }
      return {
        ok: true,
        configured: true,
        unreadable: false,
        paymentConfigured: paymentConfigured(),
        settings: {
          appId: s.appId,
          privateKeyMasked: maskSecret(s.privateKey),
          alipayPublicKeyMasked: maskSecret(s.alipayPublicKey),
          gateway: s.gateway,
          storeId: s.storeId,
          sellerId: s.sellerId,
          notifyUrl: s.notifyUrl,
        },
        epay,
        usdt,
        paymentMethodLabels,
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
      if (d.paymentMethodLabels) {
        savePaymentMethodLabels(d.paymentMethodLabels);
      }
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
      const check = validateAlipayConfig();
      return {
        ok: true,
        configured: true,
        valid: check.ok,
        warning: check.ok ? undefined : check.error,
      };
    },
  );

  /** 本地检测密钥格式，不向支付宝发起真实扣款。 */
  app.post(
    '/api/admin/settings/check',
    { preHandler: requireAdmin },
    async (_req, reply) => {
      const check = validateAlipayConfig();
      if (!check.ok) {
        return reply
          .code(400)
          .send({ ok: false, error: check.error || '配置校验失败' });
      }
      return { ok: true, message: '配置校验通过，密钥格式正确' };
    },
  );

  app.put(
    '/api/admin/settings/epay',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const parsed = epaySettingsSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({
          ok: false,
          error: parsed.error.issues.map((i) => i.message).join('; '),
        });
      }
      const d = parsed.data;
      const existing = loadEpaySettings();
      const gateway = normalizeEpayGateway(d.gateway || existing?.gateway || '');
      const pid = (d.pid || '').trim() || existing?.pid || '';
      const key = (d.key || '').trim() || existing?.key || '';
      const channels = normalizeEpayChannels(d.channels);
      if (d.enabled) {
        if (!gateway || !isSafeEpayGatewayUrl(gateway)) {
          return reply.code(400).send({
            ok: false,
            error:
              '启用易支付时必须填写可公网访问的支付网关地址，不能使用内网、本机或非法协议',
          });
        }
        if (!/^[A-Za-z0-9_\-]{1,64}$/.test(pid)) {
          return reply.code(400).send({ ok: false, error: '请填写有效的商户ID' });
        }
        if (!key) {
          return reply.code(400).send({ ok: false, error: '请填写商户密钥' });
        }
        if (!channels.length) {
          return reply.code(400).send({ ok: false, error: '请至少开通一个收款渠道' });
        }
      } else if (gateway && !isSafeEpayGatewayUrl(gateway)) {
        return reply.code(400).send({
          ok: false,
          error: '支付网关地址不合法，不能使用内网、本机或非法协议',
        });
      }
      saveEpaySettings({
        enabled: d.enabled,
        gateway,
        pid,
        key: (d.key || '').trim(),
        channels,
      });
      if (d.paymentMethodLabels) {
        savePaymentMethodLabels(d.paymentMethodLabels);
      }
      logAudit({
        actor: req.adminUsername || 'admin',
        action: 'settings.epay.update',
        detail: {
          enabled: d.enabled,
          gateway,
          pid,
          channels,
        },
        ip: clientIp(req),
      });
      const check = d.enabled
        ? validateEpayConfig()
        : { ok: true as const };
      return {
        ok: true,
        configured: epayConfigured(),
        valid: check.ok,
        warning: check.ok ? undefined : check.error,
      };
    },
  );

  app.post(
    '/api/admin/settings/epay/check',
    { preHandler: requireAdmin },
    async (_req, reply) => {
      const check = validateEpayConfig();
      if (!check.ok) {
        return reply
          .code(400)
          .send({ ok: false, error: check.error || '配置校验失败' });
      }
      return { ok: true, message: '配置校验通过，网关地址、商户ID和开通渠道格式正确' };
    },
  );

  app.put(
    '/api/admin/settings/usdt',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const parsed = usdtSettingsSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({
          ok: false,
          error: parsed.error.issues.map((i) => i.message).join('; '),
        });
      }
      const d = parsed.data;
      const existing = inspectUsdtSettings().settings;
      const rateRaw = (d.rate || '').trim() || existing?.rate || '';
      const expireMinutes = normalizeExpireMinutes(
        d.expireMinutes ?? existing?.expireMinutes,
      );
      const rate = rateRaw ? normalizeUsdtRate(rateRaw) : '';
      const networksPatch: Partial<
        Record<UsdtNetworkId, { enabled: boolean; address?: string; apiKey?: string }>
      > = {};
      if (d.networks?.length) {
        for (const row of d.networks) {
          if (!isUsdtNetworkId(row.id)) {
            return reply.code(400).send({ ok: false, error: `不支持的收款网络：${row.id}` });
          }
          const resolved = applyAddressAutoEnable(row.id, {
            enabled: row.enabled,
            address: row.address,
          });
          if (!resolved.ok) {
            return reply.code(400).send({ ok: false, error: resolved.error });
          }
          networksPatch[row.id] = {
            enabled: resolved.enabled,
            address: resolved.address,
            apiKey: (row.apiKey || '').trim(),
          };
        }
      } else {
        const address = (d.address || '').trim() || existing?.address || '';
        if (address && !isUsdtReceiveAddress('trc20', address)) {
          return reply.code(400).send({ ok: false, error: '请填写有效的 TRC20 收款地址' });
        }
        if (d.enabled && !address) {
          return reply.code(400).send({ ok: false, error: '请至少启用一条收款链并填写收款地址' });
        }
        networksPatch.trc20 = {
          enabled: d.enabled && Boolean(address),
          address,
          apiKey: (d.apiKey || '').trim(),
        };
      }
      if (d.enabled) {
        if (!rate) {
          return reply
            .code(400)
            .send({ ok: false, error: '请填写有效汇率：1 USDT 等于多少人民币，最少 0.01' });
        }
        const enabledNets = USDT_NETWORK_LIST.filter((def) => {
          const patch = networksPatch[def.id];
          const addr = patch
            ? (patch.address || '').trim()
            : (existing?.networks[def.id]?.address || '').trim();
          const on = patch ? patch.enabled : Boolean(existing?.networks[def.id]?.enabled);
          return on && addr;
        });
        if (!enabledNets.length) {
          return reply.code(400).send({ ok: false, error: '请至少填写一条收款链的有效地址' });
        }
      } else if (rateRaw && !normalizeUsdtRate(rateRaw)) {
        return reply.code(400).send({ ok: false, error: '汇率格式不正确' });
      }
      saveUsdtSettings({
        enabled: d.enabled,
        rate: rate || rateRaw,
        expireMinutes,
        apiKey: (d.apiKey || '').trim(),
        networks: networksPatch,
      });
      if (d.paymentMethodLabels) {
        savePaymentMethodLabels(d.paymentMethodLabels);
      }
      logAudit({
        actor: req.adminUsername || 'admin',
        action: 'settings.usdt.update',
        detail: {
          enabled: d.enabled,
          rate: rate || rateRaw,
          expireMinutes,
          networks: Object.keys(networksPatch),
        },
        ip: clientIp(req),
      });
      const report = summarizeUsdtConfig();
      return {
        ok: true,
        configured: usdtConfigured(),
        valid: report.ok,
        warning: d.enabled && !report.ok ? report.error : undefined,
        message: report.message,
        ready: report.ready,
        issues: report.issues,
      };
    },
  );

  app.post(
    '/api/admin/settings/usdt/check',
    { preHandler: requireAdmin },
    async (_req, reply) => {
      const report = summarizeUsdtConfig();
      if (!report.ok) {
        return reply.code(400).send({
          ok: false,
          error: report.message,
          message: report.message,
          ready: report.ready,
          issues: report.issues,
        });
      }
      return {
        ok: true,
        message: report.message,
        ready: report.ready,
        issues: report.issues,
      };
    },
  );

  app.get(
    '/api/admin/status',
    { preHandler: requireAdmin },
    async () => ({
      ok: true,
      configured: paymentConfigured(),
      alipayConfigured: settingsConfigured(),
      epayConfigured: epayConfigured(),
      usdtConfigured: usdtConfigured(),
      gateway: loadAlipaySettings()?.gateway ?? config.gateway,
      notifyUrl: loadAlipaySettings()?.notifyUrl ?? config.notifyUrl,
    }),
  );

  app.get(
    '/api/admin/orders',
    { preHandler: requireAdmin },
    async (req) => {
      const q = req.query as {
        limit?: string;
        q?: string;
        payStatus?: string;
        fulfillment?: string;
        sortBy?: string;
        sortOrder?: string;
        page?: string;
        pageSize?: string;
      };
      const payStatus: AdminOrderPayStatus =
        q.payStatus === 'paid' ||
        q.payStatus === 'pending' ||
        q.payStatus === 'closed'
          ? q.payStatus
          : 'all';
      const fulfillment: AdminOrderFulfillment =
        q.fulfillment === 'pending_fulfillment' ||
        q.fulfillment === 'delivered' ||
        q.fulfillment === 'none'
          ? q.fulfillment
          : 'all';
      const sortBy: AdminOrderSortBy =
        q.sortBy === 'total_amount' ||
        q.sortBy === 'status' ||
        q.sortBy === 'subject' ||
        q.sortBy === 'id' ||
        q.sortBy === 'created_at'
          ? q.sortBy
          : 'created_at';
      const sortOrder = q.sortOrder === 'asc' ? 'asc' : 'desc';
      const page = normalizeAdminListPage(q.page);
      const pageSize = q.pageSize
        ? normalizeAdminListPageSize(q.pageSize)
        : q.limit
          ? normalizeAdminListPageSize(q.limit)
          : 15;
      const result = queryAdminOrders({
        q: q.q,
        payStatus,
        fulfillment,
        sortBy,
        sortOrder,
        page,
        pageSize,
      });
      return {
        ok: true,
        orders: attachKeysToOrders(result.orders),
        total: result.total,
        page: result.page,
        pageSize: result.pageSize,
      };
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
      const q = req.query as {
        page?: string;
        pageSize?: string;
        q?: string;
        action?: string;
      };
      const page = normalizeAuditPage(q.page);
      const pageSize = normalizeAuditPageSize(q.pageSize);
      return {
        ok: true,
        ...listAuditLogs(page, pageSize, { q: q.q, action: q.action }),
        retentionDays: getAuditLogRetentionDays(),
      };
    },
  );

  app.put(
    '/api/admin/audit/retention',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const days = Number((req.body as { days?: unknown } | undefined)?.days);
      try {
        const retentionDays = setAuditLogRetentionDays(days);
        return { ok: true, retentionDays };
      } catch (err) {
        const message = err instanceof Error ? err.message : '保留时间无效';
        return reply.code(400).send({ ok: false, error: message });
      }
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
        configured: paymentConfigured(),
        alipayConfigured: settingsConfigured(),
        epayConfigured: epayConfigured(),
        usdtConfigured: usdtConfigured(),
      };
    },
  );
}
