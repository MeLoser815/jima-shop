import { AlipaySdk } from 'alipay-sdk';
import {
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

export function createSdk(settings?: AlipaySettings | null): AlipaySdk {
  const s = settings ?? loadAlipaySettings();
  if (!s) {
    throw new AlipayConfigError(
      '尚未配置支付宝：请在管理后台填写 AppId、应用私钥、支付宝公钥',
    );
  }
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
}

/**
 * 统一解析 SDK 返回：业务失败（含无签名的错误响应）明确返回，不伪装成网络错误。
 */
function parseResult(raw: Record<string, unknown>): AlipayBizResult {
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


function resolveNotifyUrl(override?: string, fallback?: string): string | undefined {
  return (override || fallback || '').trim() || undefined;
}

function rejectIfNotifyUnusable(notifyUrl: string | undefined): AlipayBizResult | null {
  if (config.nodeEnv !== 'production') return null;
  if (isPublicHttpsUrl(notifyUrl)) return null;
  return {
    ok: false,
    msg: '尚未配置公网 HTTPS 异步通知地址。请在管理后台「支付宝收款」中填写，例如 https://你的域名/api/payment/notify。',
    raw: {},
  };
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
}): Promise<AlipayBizResult> {
  const settings = loadAlipaySettings();
  const notifyUrl = resolveNotifyUrl(input.notifyUrl, settings?.notifyUrl);
  const blocked = rejectIfNotifyUnusable(notifyUrl);
  if (blocked) return blocked;
  const sdk = createSdk(settings);
  const storeId = input.storeId || settings!.storeId;

  try {
    const raw = (await sdk.exec('alipay.trade.precreate', {
      notifyUrl,
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
}): Promise<AlipayBizResult> {
  const settings = loadAlipaySettings();
  const notifyUrl = resolveNotifyUrl(input.notifyUrl, settings?.notifyUrl);
  const blocked = rejectIfNotifyUnusable(notifyUrl);
  if (blocked) return blocked;
  const sdk = createSdk(settings);
  const storeId = input.storeId || settings!.storeId;

  try {
    const raw = (await sdk.exec('alipay.trade.pay', {
      notifyUrl,
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
    return coerceSdkError(err);
  }
}

/** 交易查询 alipay.trade.query */
export async function tradeQuery(outTradeNo: string): Promise<AlipayBizResult> {
  const sdk = createSdk();
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
