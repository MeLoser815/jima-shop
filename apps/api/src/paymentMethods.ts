export const EPAY_CHANNELS = ['alipay', 'wxpay', 'qqpay'] as const;
export type EpayChannel = (typeof EPAY_CHANNELS)[number];

export const PAYMENT_METHOD_IDS = [
  'alipay_f2f',
  'epay_alipay',
  'epay_wxpay',
  'epay_qqpay',
  'usdt_trc20',
  'usdt_bep20',
  'usdt_erc20',
  'usdt_polygon',
  'usdt_arbitrum',
  'usdt_optimism',
  'usdt_avax',
  'usdt_xlayer',
] as const;
export type PaymentMethodId = (typeof PAYMENT_METHOD_IDS)[number];

export type StorePaymentMethod = {
  id: PaymentMethodId;
  /** 买家可见名称，默认中文名；管理员自定义后以自定义为准 */
  label: string;
};

export type PaymentMethodLabels = Partial<Record<PaymentMethodId, string>>;

export const PAYMENT_LABEL_MAX_LEN = 20;

export const DEFAULT_METHOD_LABEL: Record<PaymentMethodId, string> = {
  alipay_f2f: '支付宝',
  epay_alipay: '支付宝',
  epay_wxpay: '微信',
  epay_qqpay: 'QQ钱包',
  usdt_trc20: 'USDT (TRC20)',
  usdt_bep20: 'USDT (BEP20)',
  usdt_erc20: 'USDT (ERC20)',
  usdt_polygon: 'USDT (Polygon)',
  usdt_arbitrum: 'USDT (Arbitrum)',
  usdt_optimism: 'USDT (Optimism)',
  usdt_avax: 'USDT (Avalanche)',
  usdt_xlayer: 'USDT (X Layer)',
};

const CHANNEL_LABEL: Record<EpayChannel, string> = {
  alipay: '支付宝',
  wxpay: '微信',
  qqpay: 'QQ钱包',
};

export function isEpayChannel(value: string): value is EpayChannel {
  return (EPAY_CHANNELS as readonly string[]).includes(value);
}

export function isPaymentMethodId(value: string): value is PaymentMethodId {
  return (PAYMENT_METHOD_IDS as readonly string[]).includes(value);
}

export function normalizeEpayChannels(input: unknown): EpayChannel[] {
  const src = Array.isArray(input)
    ? input
    : typeof input === 'string'
      ? safeJsonArray(input)
      : [];
  const seen = new Set<EpayChannel>();
  const out: EpayChannel[] = [];
  for (const raw of src) {
    const v = String(raw).trim();
    if (isEpayChannel(v) && !seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}

function safeJsonArray(s: string): unknown[] {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

/** 去掉 HTML、控制符和多余空白，限制长度；空字符串表示未填写。 */
export function sanitizePaymentLabel(raw: unknown): string {
  let s = String(raw ?? '');
  s = s.replace(/<[^>]*>/g, '');
  s = s.replace(/[<>]/g, '');
  s = s.replace(/[\u0000-\u001F\u007F]/g, '');
  s = s.replace(/\s+/g, ' ').trim();
  if (s.length > PAYMENT_LABEL_MAX_LEN) {
    s = s.slice(0, PAYMENT_LABEL_MAX_LEN).trim();
  }
  return s;
}

export function normalizePaymentMethodLabels(input: unknown): PaymentMethodLabels {
  let obj: Record<string, unknown> = {};
  if (typeof input === 'string') {
    try {
      const v = JSON.parse(input);
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        obj = v as Record<string, unknown>;
      }
    } catch {
      obj = {};
    }
  } else if (input && typeof input === 'object' && !Array.isArray(input)) {
    obj = input as Record<string, unknown>;
  }
  const out: PaymentMethodLabels = {};
  for (const id of PAYMENT_METHOD_IDS) {
    if (!(id in obj)) continue;
    const cleaned = sanitizePaymentLabel(obj[id]);
    if (cleaned) out[id] = cleaned;
  }
  return out;
}

/** 只更新 patch 中出现的键；空值表示恢复默认名，未出现的键保持原样。 */
export function mergePaymentMethodLabels(
  existing: PaymentMethodLabels,
  patch: unknown,
): PaymentMethodLabels {
  const next: PaymentMethodLabels = { ...existing };
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return next;
  const obj = patch as Record<string, unknown>;
  for (const id of PAYMENT_METHOD_IDS) {
    if (!(id in obj)) continue;
    const cleaned = sanitizePaymentLabel(obj[id]);
    if (cleaned) next[id] = cleaned;
    else delete next[id];
  }
  return next;
}

export function defaultPaymentLabel(channel: string | null | undefined): string {
  if (channel && isPaymentMethodId(channel)) return DEFAULT_METHOD_LABEL[channel];
  return '支付宝';
}

/**
 * 买家可见名称：优先用下单时写入订单的名称，否则用当前自定义名，再否则用默认名。
 */
export function resolvePaymentLabel(
  channel: string | null | undefined,
  opts?: {
    labels?: PaymentMethodLabels | null;
    storedLabel?: string | null;
  },
): string {
  const stored = sanitizePaymentLabel(opts?.storedLabel ?? '');
  if (stored) return stored;
  if (channel && isPaymentMethodId(channel)) {
    const custom = opts?.labels?.[channel];
    if (custom) return custom;
    return DEFAULT_METHOD_LABEL[channel];
  }
  return '支付宝';
}

export function epayChannelLabel(channel: EpayChannel): string {
  return CHANNEL_LABEL[channel];
}

export function paymentChannelLabel(
  channel: string | null | undefined,
  storedLabel?: string | null,
): string {
  return resolvePaymentLabel(channel, { storedLabel });
}

export function epayTypeFromMethod(
  method: PaymentMethodId,
): EpayChannel | null {
  if (method === 'epay_alipay') return 'alipay';
  if (method === 'epay_wxpay') return 'wxpay';
  if (method === 'epay_qqpay') return 'qqpay';
  return null;
}

export function methodFromEpayType(type: EpayChannel): PaymentMethodId {
  if (type === 'wxpay') return 'epay_wxpay';
  if (type === 'qqpay') return 'epay_qqpay';
  return 'epay_alipay';
}

export function isEpayPaymentChannel(
  channel: string | null | undefined,
): boolean {
  return Boolean(channel && channel.startsWith('epay_'));
}

export function isUsdtPaymentChannel(
  channel: string | null | undefined,
): boolean {
  return Boolean(channel && (PAYMENT_METHOD_IDS as readonly string[]).includes(channel) && channel.startsWith('usdt_'));
}

/**
 * 当前对买家开放的支付方式。
 * 官方当面付与易支付支付宝同时开通时，两个选项都会出现，名称以管理员设置为准。
 */
export function listAvailablePaymentMethods(input: {
  alipayConfigured: boolean;
  epayConfigured: boolean;
  epayChannels: EpayChannel[];
  usdtConfigured?: boolean;
  /** 已启用且地址配好的 USDT 链，按链各出现一个结账选项。 */
  usdtChannels?: PaymentMethodId[];
  labels?: PaymentMethodLabels | null;
}): StorePaymentMethod[] {
  const methods: StorePaymentMethod[] = [];
  const labelOf = (id: PaymentMethodId) =>
    resolvePaymentLabel(id, { labels: input.labels });

  if (input.alipayConfigured) {
    methods.push({ id: 'alipay_f2f', label: labelOf('alipay_f2f') });
  }
  if (input.epayConfigured) {
    const channels = normalizeEpayChannels(input.epayChannels).sort(
      (a, b) => EPAY_CHANNELS.indexOf(a) - EPAY_CHANNELS.indexOf(b),
    );
    for (const ch of channels) {
      const id = methodFromEpayType(ch);
      methods.push({ id, label: labelOf(id) });
    }
  }
  const usdtIds = (input.usdtChannels || []).filter(
    (id) => isPaymentMethodId(id) && isUsdtPaymentChannel(id),
  );
  if (usdtIds.length) {
    for (const id of usdtIds) {
      methods.push({ id, label: labelOf(id) });
    }
  } else if (input.usdtConfigured) {
    methods.push({ id: 'usdt_trc20', label: labelOf('usdt_trc20') });
  }
  return methods;
}
