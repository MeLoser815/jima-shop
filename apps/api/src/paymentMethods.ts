export const EPAY_CHANNELS = ['alipay', 'wxpay', 'qqpay'] as const;
export type EpayChannel = (typeof EPAY_CHANNELS)[number];

export const PAYMENT_METHOD_IDS = [
  'alipay_f2f',
  'epay_alipay',
  'epay_wxpay',
  'epay_qqpay',
] as const;
export type PaymentMethodId = (typeof PAYMENT_METHOD_IDS)[number];

export type StorePaymentMethod = {
  id: PaymentMethodId;
  /** 买家可见的中文名称，不含「易支付」等商户术语 */
  label: string;
};

const CHANNEL_LABEL: Record<EpayChannel, string> = {
  alipay: '支付宝',
  wxpay: '微信',
  qqpay: 'QQ钱包',
};

const METHOD_LABEL: Record<PaymentMethodId, string> = {
  alipay_f2f: '支付宝',
  epay_alipay: '支付宝',
  epay_wxpay: '微信',
  epay_qqpay: 'QQ钱包',
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

export function epayChannelLabel(channel: EpayChannel): string {
  return CHANNEL_LABEL[channel];
}

export function paymentChannelLabel(
  channel: string | null | undefined,
): string {
  if (channel && isPaymentMethodId(channel)) return METHOD_LABEL[channel];
  return '支付宝';
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

/**
 * 当前对买家开放的支付方式。
 * 官方当面付与易支付支付宝同时开通时，买家只看到一个「支付宝」（走当面付）。
 */
export function listAvailablePaymentMethods(input: {
  alipayConfigured: boolean;
  epayConfigured: boolean;
  epayChannels: EpayChannel[];
}): StorePaymentMethod[] {
  const methods: StorePaymentMethod[] = [];
  if (input.alipayConfigured) {
    methods.push({ id: 'alipay_f2f', label: METHOD_LABEL.alipay_f2f });
  }
  if (input.epayConfigured) {
    const channels = normalizeEpayChannels(input.epayChannels).sort(
      (a, b) => EPAY_CHANNELS.indexOf(a) - EPAY_CHANNELS.indexOf(b),
    );
    for (const ch of channels) {
      if (ch === 'alipay' && input.alipayConfigured) continue;
      const id = methodFromEpayType(ch);
      methods.push({ id, label: METHOD_LABEL[id] });
    }
  }
  return methods;
}
