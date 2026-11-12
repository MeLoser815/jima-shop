import { createSign, createPublicKey } from 'node:crypto';
import { AlipaySdk } from 'alipay-sdk';
import {
  inspectAlipaySettings,
  loadAlipaySettings,
  type AlipaySettings,
} from './db.js';
import { isPublicHttpsUrl } from './security.js';
import { config } from './config.js';
import {
  detectPrivateKeyType,
  normalizePrivateKey,
  normalizePublicKey,
} from './utils/crypto.js';

export type AlipayBizResult = {
  ok: boolean;
  /** 网关/业务 code，成功一般为 10000 */
  code?: string;
  msg?: string;
  subCode?: string;
  subMsg?: string;
  /** 原始结果（便于排查，不要返回给前台） */
  raw: Record<string, unknown>;
  qrCode?: string;
  outTradeNo?: string;
  tradeNo?: string;
  buyerLogonId?: string;
  tradeStatus?: string;
  totalAmount?: string;
  appId?: string;
  sellerId?: string;
};

export class AlipayConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AlipayConfigError';
  }
}

export type AlipayAudience = 'buyer' | 'admin';

export function alipayMissingConfigMessage(audience: AlipayAudience = 'admin'): string {
  const info = inspectAlipaySettings();
  if (audience === 'buyer') {
    return '支付暂不可用，请稍后再试或联系商家';
  }
  if (info.unreadable) {
    return '收款密钥无法读取，请在后台重新保存支付宝配置';
  }
  return '尚未配置支付宝：请在管理后台填写 AppId、应用私钥、支付宝公钥';
}

export function requireAlipaySettings(
  audience: AlipayAudience = 'admin',
): AlipaySettings {
  const s = loadAlipaySettings();
  if (s) return s;
  throw new AlipayConfigError(alipayMissingConfigMessage(audience));
}

export function createSdk(
  settings?: AlipaySettings | null,
  audience: AlipayAudience = 'admin',
): AlipaySdk {
  const s = settings ?? requireAlipaySettings(audience);
  try {
    return new AlipaySdk({
      appId: s.appId,
      privateKey: normalizePrivateKey(s.privateKey),
      alipayPublicKey: normalizePublicKey(s.alipayPublicKey),
      gateway: s.gateway,
      keyType: detectPrivateKeyType(s.privateKey),
      signType: 'RSA2',
      charset: 'utf-8',
      timeout: 15000,
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new AlipayConfigError(
      audience === 'buyer'
        ? '支付暂不可用，请稍后再试或联系商家'
        : `支付宝密钥无法使用，请检查应用私钥与支付宝公钥是否填对（${detail}）`,
    );
  }
}

/** 本地校验密钥能否用于签名，不向支付宝发起真实扣款。 */
export function validateAlipayConfig(settings?: AlipaySettings | null): {
  ok: boolean;
  error?: string;
} {
  try {
    const s = settings ?? loadAlipaySettings();
    if (!s) {
      return { ok: false, error: alipayMissingConfigMessage('admin') };
    }
    const appId = s.appId.trim();
    if (!/^\d{8,32}$/.test(appId)) {
      return { ok: false, error: 'AppId 格式不正确，应为开放平台应用的数字 AppId' };
    }
    const privateKey = normalizePrivateKey(s.privateKey);
    const publicKey = normalizePublicKey(s.alipayPublicKey);
    createSign('RSA-SHA256').update('jima-alipay-config-check').sign(privateKey, 'base64');
    createPublicKey(publicKey);
    createSdk(s, 'admin');
    return { ok: true };
  } catch (err) {
    if (err instanceof AlipayConfigError) {
      return { ok: false, error: err.message };
    }
    return {
      ok: false,
      error: '密钥无法使用，请检查应用私钥与支付宝公钥是否填对、格式是否完整',
    };
  }
}

export function precreateFailureMessage(
  result: AlipayBizResult,
  opts?: { insecureHttp?: boolean },
): string {
  const raw = result.subMsg || result.msg || '生成收款码失败，请稍后重试';
  const notifyRelated = /notify_url|异步通知|通知地址/i.test(
    `${raw} ${result.subCode ?? ''}`,
  );
  if (notifyRelated || (opts?.insecureHttp && /undefined|invalid.*url/i.test(raw))) {
    return '当前不是通过 HTTPS 域名访问，无法完成支付宝下单。请使用店铺的 HTTPS 地址打开后再支付。';
  }
  if (opts?.insecureHttp) {
    return `${raw}。若仍无法支付，请改用店铺的 HTTPS 地址打开后再试。`;
  }
  return raw;
}

export function qrCodeFromResult(result: AlipayBizResult): string | undefined {
  const qr = String(result.qrCode || '').trim();
  return qr || undefined;
}

/**
 * 统一解析 SDK 返回：业务失败（含无签名的错误响应）明确返回，不伪装成网络错误。
 */
export function parseResult(raw: Record<string, unknown>): AlipayBizResult {
  const nested = raw.alipay_trade_precreate_response;
  if (nested && typeof nested === 'object' && !raw.code && !raw.qr_code && !raw.qrCode) {
    return parseResult(nested as Record<string, unknown>);
  }
  const code = String(raw.code ?? raw.CODE ?? '');
  const msg = String(raw.msg ?? raw.MSG ?? '');
  const subCode = raw.subCode
    ? String(raw.subCode)
    : raw.sub_code
      ? String(raw.sub_code)
      : undefined;
  const subMsg = raw.subMsg
    ? String(raw.subMsg)
    : raw.sub_msg
      ? String(raw.sub_msg)
      : undefined;

  const ok = code === '10000';
  return {
    ok,
    code: code || undefined,
    msg: msg || undefined,
    subCode,
    subMsg,
    raw,
    qrCode: (raw.qrCode ?? raw.qr_code) as string | undefined,
    outTradeNo: (raw.outTradeNo ?? raw.out_trade_no) as string | undefined,
    tradeNo: (raw.tradeNo ?? raw.trade_no) as string | undefined,
    buyerLogonId: (raw.buyerLogonId ?? raw.buyer_logon_id) as
      | string
      | undefined,
    tradeStatus: (raw.tradeStatus ?? raw.trade_status) as string | undefined,
    totalAmount: (raw.totalAmount ?? raw.total_amount) as string | undefined,
    appId: (raw.appId ?? raw.app_id) as string | undefined,
    sellerId: (raw.sellerId ?? raw.seller_id) as string | undefined,
  };
}


/**
 * 优先使用后台手动填写的公网 HTTPS 通知地址；
 * 未填写时用当前访问域名自动拼出，例如 https://pay.example.com/api/payment/notify。
 * 都没有时不传 notify_url，改由前台轮询查单。
 */
export function resolveNotifyUrl(
  configured?: string,
  autoFromRequest?: string,
): string | undefined {
  const usable = (url: string | undefined): string | undefined => {
    const t = (url || '').trim() || undefined;
    if (!t) return undefined;
    if (config.nodeEnv === 'production' && !isPublicHttpsUrl(t)) return undefined;
    return t;
  };
  return usable(configured) || usable(autoFromRequest);
}
/**
 * 当面付 · 收款码预下单 alipay.trade.precreate
 */
export async function tradePrecreate(input: {
  outTradeNo: string;
  totalAmount: string;
  subject: string;
  body?: string;
  storeId?: string;
  notifyUrl?: string;
  audience?: AlipayAudience;
}): Promise<AlipayBizResult> {
  const audience = input.audience ?? 'admin';
  const settings = requireAlipaySettings(audience);
  const notifyUrl = resolveNotifyUrl(settings.notifyUrl, input.notifyUrl);
  const sdk = createSdk(settings, audience);
  const storeId = input.storeId || settings.storeId;

  try {
    const raw = (await sdk.exec('alipay.trade.precreate', {
      ...(notifyUrl ? { notifyUrl } : {}),
      bizContent: {
        out_trade_no: input.outTradeNo,
        total_amount: input.totalAmount,
        subject: input.subject,
        body: input.body,
        store_id: storeId || undefined,
        timeout_express: '15m',
      },
    })) as Record<string, unknown>;
    return parseResult(raw);
  } catch (err) {
    if (err instanceof AlipayConfigError) throw err;
    return coerceSdkError(err);
  }
}

/**
 * 当面付 · 付款码支付 alipay.trade.pay
 */
export async function tradePay(input: {
  outTradeNo: string;
  totalAmount: string;
  subject: string;
  authCode: string;
  storeId?: string;
  notifyUrl?: string;
  audience?: AlipayAudience;
}): Promise<AlipayBizResult> {
  const audience = input.audience ?? 'admin';
  const settings = requireAlipaySettings(audience);
  const notifyUrl = resolveNotifyUrl(settings.notifyUrl, input.notifyUrl);
  const sdk = createSdk(settings, audience);
  const storeId = input.storeId || settings.storeId;

  try {
    const raw = (await sdk.exec('alipay.trade.pay', {
      ...(notifyUrl ? { notifyUrl } : {}),
      bizContent: {
        out_trade_no: input.outTradeNo,
        total_amount: input.totalAmount,
        subject: input.subject,
        scene: 'bar_code',
        auth_code: input.authCode,
        store_id: storeId || undefined,
      },
    })) as Record<string, unknown>;
    return parseResult(raw);
  } catch (err) {
    if (err instanceof AlipayConfigError) throw err;
    return coerceSdkError(err);
  }
}

/** 交易查询 alipay.trade.query */
export async function tradeQuery(outTradeNo: string): Promise<AlipayBizResult> {
  const sdk = createSdk(undefined, 'admin');
  try {
    const raw = (await sdk.exec('alipay.trade.query', {
      bizContent: { out_trade_no: outTradeNo },
    })) as Record<string, unknown>;
    return parseResult(raw);
  } catch (err) {
    return coerceSdkError(err);
  }
}

/** 异步通知验签 */
export function checkNotifySign(
  params: Record<string, string>,
): boolean {
  const sdk = createSdk();
  // alipay-sdk: checkNotifySign
  return Boolean(sdk.checkNotifySign(params));
}

/**
 * 官方 SDK 在「有业务错误但无 sign」时可能抛错；
 * 尽量抽出 code/subMsg，避免误报网络故障。
 */
function coerceSdkError(err: unknown): AlipayBizResult {
  const e = err as Error & {
    code?: string;
    data?: Record<string, unknown>;
    response?: Record<string, unknown>;
    serverResult?: Record<string, unknown>;
  };

  const candidate =
    e.data ||
    e.response ||
    e.serverResult ||
    (typeof e.message === 'string' && e.message.startsWith('{')
      ? safeJson(e.message)
      : null);

  if (candidate && typeof candidate === 'object') {
    const parsed = parseResult(candidate as Record<string, unknown>);
    if (parsed.code || parsed.subCode || parsed.msg) {
      return {
        ...parsed,
        ok: false,
        msg: parsed.msg || e.message,
      };
    }
  }

  // 常见：Invalid app id / 无效的AppID —— 从 message 提取
  const msg = e.message || String(err);
  const looksBiz =
    /app.?id|无效|签名|验签|Business Failed|isv\./i.test(msg) ||
    Boolean(e.code);

  return {
    ok: false,
    code: e.code || (looksBiz ? 'BIZ_ERROR' : 'SDK_ERROR'),
    msg: looksBiz
      ? msg
      : `调用支付宝失败: ${msg}`,
    raw: { error: msg, code: e.code },
  };
}

function safeJson(s: string): Record<string, unknown> | null {
  try {
    return JSON.parse(s) as Record<string, unknown>;
  } catch {
    return null;
  }
}
