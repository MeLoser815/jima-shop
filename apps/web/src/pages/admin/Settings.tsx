import { useEffect, useState } from 'react';
import {
  Alert,
  App,
  Button,
  Checkbox,
  Collapse,
  Form,
  Input,
  InputNumber,
  Select,
  Switch,
  Tabs,
  Tag,
  Typography,
} from 'antd';
import { api } from '../../api';

const SANDBOX = 'https://openapi-sandbox.dl.alipaydev.com/gateway.do';
const PROD = 'https://openapi.alipay.com/gateway.do';

const USDT_CHAINS = [
  {
    id: 'trc20',
    channel: 'usdt_trc20',
    title: 'Tron TRC20',
    short: 'TRC20',
    evm: false,
    placeholder: '以 T 开头的波场地址',
    extra: '填写你自己的波场 USDT（TRC20）钱包地址。请勿填写无法区分唯一金额的交易所充值地址。',
  },
  {
    id: 'bep20',
    channel: 'usdt_bep20',
    title: 'BNB Smart Chain（BEP20）',
    short: 'BEP20',
    evm: true,
    placeholder: '0x 开头的 BNB 智能链地址',
    extra: '币安智能链主网。该链 USDT 为 18 位小数，系统会按精确金额匹配，请提醒买家不要转错链。',
  },
  {
    id: 'erc20',
    channel: 'usdt_erc20',
    title: 'Ethereum ERC20',
    short: 'ERC20',
    evm: true,
    placeholder: '0x 开头的以太坊地址',
    extra: '以太坊主网 USDT（6 位小数）。手续费较高，请向买家写清网络名称。',
  },
  {
    id: 'polygon',
    channel: 'usdt_polygon',
    title: 'Polygon',
    short: 'Polygon',
    evm: true,
    placeholder: '0x 开头的 Polygon 地址',
    extra: 'Polygon 主网 USDT（6 位小数）。',
  },
  {
    id: 'arbitrum',
    channel: 'usdt_arbitrum',
    title: 'Arbitrum One',
    short: 'Arbitrum',
    evm: true,
    placeholder: '0x 开头的 Arbitrum 地址',
    extra: 'Arbitrum One 主网 USDT（6 位小数）。',
  },
  {
    id: 'optimism',
    channel: 'usdt_optimism',
    title: 'Optimism',
    short: 'Optimism',
    evm: true,
    placeholder: '0x 开头的 Optimism 地址',
    extra: 'OP Mainnet USDT（6 位小数）。',
  },
  {
    id: 'avax',
    channel: 'usdt_avax',
    title: 'Avalanche C-Chain',
    short: 'Avalanche',
    evm: true,
    placeholder: '0x 开头的 Avalanche 地址',
    extra: 'Avalanche C 链官方 USDT（6 位小数）。',
  },
  {
    id: 'xlayer',
    channel: 'usdt_xlayer',
    title: '欧易链（X Layer）',
    short: 'X Layer',
    evm: true,
    placeholder: '0x 开头的 X Layer 地址',
    extra: '当前发卡场景中的「欧易链」是 OKX X Layer 主网（Chain ID 196），不是已较少使用的 OKT Chain/OKC。系统按官方 USDT0 确认到账，并同时识别仍在流通的旧版 USDT，避免漏单。',
  },
] as const;

const DEFAULT_USDT_RATE = '7.20';

function usdtAddressLooksValid(chainId: string, raw: string): boolean {
  const v = raw.trim();
  if (chainId === 'trc20') return /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(v);
  return /^0x[a-fA-F0-9]{40}$/.test(v);
}

const EPAY_CHANNEL_OPTIONS = [
  { value: 'alipay', label: '支付宝' },
  { value: 'wxpay', label: '微信' },
  { value: 'qqpay', label: 'QQ钱包' },
];

function suggestedNotifyUrl(): string {
  if (typeof window === 'undefined') return '';
  try {
    const origin = window.location.origin;
    const host = new URL(origin).hostname;
    if (!origin.startsWith('https://')) return '';
    if (host === 'localhost' || host === '127.0.0.1') return '';
    return `${origin}/api/payment/notify`;
  } catch {
    return '';
  }
}

type FormVals = {
  appId: string;
  privateKey: string;
  alipayPublicKey: string;
  gateway: string;
  storeId: string;
  sellerId: string;
  notifyUrl: string;
  buyerLabel: string;
};

type EpayFormVals = {
  enabled: boolean;
  gateway: string;
  pid: string;
  key: string;
  channels: string[];
  label_epay_alipay: string;
  label_epay_wxpay: string;
  label_epay_qqpay: string;
};

type UsdtFormVals = {
  enabled: boolean;
  rate: string;
  expireMinutes: number;
  [key: string]: unknown;
};

export default function Settings() {
  const { message } = App.useApp();
  const [form] = Form.useForm<FormVals>();
  const [epayForm] = Form.useForm<EpayFormVals>();
  const [usdtForm] = Form.useForm<UsdtFormVals>();
  const [configured, setConfigured] = useState(false);
  const [unreadable, setUnreadable] = useState(false);
  const [masked, setMasked] = useState({ priv: '', pub: '' });
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [feedback, setFeedback] = useState<{
    type: 'success' | 'error' | 'warning';
    text: string;
  } | null>(null);

  const [epayEnabled, setEpayEnabled] = useState(false);
  const [epayConfigured, setEpayConfigured] = useState(false);
  const [epayUnreadable, setEpayUnreadable] = useState(false);
  const [epayKeyMasked, setEpayKeyMasked] = useState('');
  const [epayBusy, setEpayBusy] = useState(false);
  const [epayChecking, setEpayChecking] = useState(false);
  const [epayFeedback, setEpayFeedback] = useState<{
    type: 'success' | 'error' | 'warning';
    text: string;
  } | null>(null);

  const [usdtEnabled, setUsdtEnabled] = useState(false);
  const [usdtConfigured, setUsdtConfigured] = useState(false);
  const [usdtUnreadable, setUsdtUnreadable] = useState(false);
  const [usdtKeyMasks, setUsdtKeyMasks] = useState<Record<string, string>>({});
  const [usdtBusy, setUsdtBusy] = useState(false);
  const [usdtChecking, setUsdtChecking] = useState(false);
  const [usdtFeedback, setUsdtFeedback] = useState<{
    type: 'success' | 'error' | 'warning';
    text: string;
  } | null>(null);
  const [usdtScanHint, setUsdtScanHint] = useState('');
  const [usdtSelectedChain, setUsdtSelectedChain] = useState<(typeof USDT_CHAINS)[number]['id']>('trc20');
  const [usdtReadyIds, setUsdtReadyIds] = useState<string[]>([]);
  const [payTab, setPayTab] = useState('alipay');
  const epayChannels = Form.useWatch('channels', epayForm) || [];

  useEffect(() => {
    api
      .getSettings()
      .then((res) => {
        setConfigured(res.configured);
        setUnreadable(Boolean(res.unreadable));
        setMasked({
          priv: res.settings.privateKeyMasked,
          pub: res.settings.alipayPublicKeyMasked,
        });
        const labels = res.paymentMethodLabels || {};
        form.setFieldsValue({
          appId: res.settings.appId || '',
          gateway: res.settings.gateway || PROD,
          storeId: res.settings.storeId || '',
          sellerId: res.settings.sellerId || '',
          notifyUrl: res.settings.notifyUrl || suggestedNotifyUrl(),
          privateKey: '',
          alipayPublicKey: '',
          buyerLabel: labels.alipay_f2f || '',
        });
        const epay = res.epay;
        if (epay) {
          setEpayEnabled(epay.enabled);
          setEpayConfigured(epay.configured);
          setEpayUnreadable(epay.unreadable);
          setEpayKeyMasked(epay.settings.keyMasked || '');
          epayForm.setFieldsValue({
            enabled: epay.enabled,
            gateway: epay.settings.gateway || '',
            pid: epay.settings.pid || '',
            key: '',
            channels: epay.settings.channels || [],
            label_epay_alipay: labels.epay_alipay || '',
            label_epay_wxpay: labels.epay_wxpay || '',
            label_epay_qqpay: labels.epay_qqpay || '',
          });
        }
        const usdt = res.usdt;
        if (usdt) {
          setUsdtEnabled(usdt.enabled);
          setUsdtConfigured(usdt.configured);
          setUsdtUnreadable(usdt.unreadable);
          const nets = usdt.settings.networks || [];
          const masks: Record<string, string> = {};
          const fields: Record<string, unknown> = {
            enabled: usdt.enabled,
            rate: usdt.settings.rate || DEFAULT_USDT_RATE,
            expireMinutes: usdt.settings.expireMinutes || 15,
          };
          const readyIds: string[] = [];
          for (const ch of USDT_CHAINS) {
            const n = nets.find((x) => x.id === ch.id);
            const address = n?.address || (ch.id === 'trc20' ? usdt.settings.address || '' : '');
            const enabled = Boolean(n?.enabled && address);
            fields[`net_${ch.id}_enabled`] = enabled;
            fields[`net_${ch.id}_address`] = address;
            fields[`net_${ch.id}_apiKey`] = '';
            fields[`net_${ch.id}_label`] = labels[ch.channel] || '';
            if (enabled) readyIds.push(ch.id);
            if (n?.apiKeyMasked) masks[ch.id] = n.apiKeyMasked;
            else if (ch.id === 'trc20' && usdt.settings.apiKeyMasked) masks[ch.id] = usdt.settings.apiKeyMasked;
          }
          setUsdtKeyMasks(masks);
          setUsdtReadyIds(readyIds);
          const firstReady = USDT_CHAINS.find((ch) => readyIds.includes(ch.id));
          setUsdtSelectedChain(firstReady?.id || 'trc20');
          usdtForm.setFieldsValue(fields);
          const hints: string[] = [];
          if (!nets.some((n) => n.apiKeyMasked) && !usdt.settings.apiKeyMasked) {
            hints.push('建议为查询繁忙的链填写 API Key，以降低查账限流风险。');
          }
          const scan = usdt.scanStatus;
          if (scan && scan.ok === false) {
            const when = scan.at ? `（${new Date(scan.at).toLocaleString()}）` : '';
            hints.push(`最近一次到账查询未成功${when}，将自动重试，不会因此关闭待付订单。`);
          }
          setUsdtScanHint(hints.join(' '));
        }
      })
      .catch((e) => message.error((e as Error).message));
  }, [form, epayForm, usdtForm, message]);

  async function save() {
    const v = await form.validateFields();
    setBusy(true);
    setFeedback(null);
    try {
      const saved = await api.saveSettings({
        appId: v.appId,
        privateKey: v.privateKey || '',
        alipayPublicKey: v.alipayPublicKey || '',
        gateway: v.gateway,
        storeId: v.storeId,
        sellerId: v.sellerId,
        notifyUrl: v.notifyUrl,
        paymentMethodLabels: { alipay_f2f: v.buyerLabel || '' },
      });
      const res = await api.getSettings();
      setConfigured(res.configured);
      setUnreadable(Boolean(res.unreadable));
      setMasked({
        priv: res.settings.privateKeyMasked,
        pub: res.settings.alipayPublicKeyMasked,
      });
      form.setFieldsValue({
        privateKey: '',
        alipayPublicKey: '',
        buyerLabel: res.paymentMethodLabels?.alipay_f2f || '',
      });
      if (saved.warning) {
        const text = `配置已保存，但校验未通过：${saved.warning}`;
        setFeedback({ type: 'warning', text });
        message.warning(text);
      } else {
        const text = '收款配置已保存';
        setFeedback({ type: 'success', text });
        message.success(text);
      }
    } catch (e) {
      const text = (e as Error).message || '保存失败，请稍后重试';
      setFeedback({ type: 'error', text });
      message.error(text);
    } finally {
      setBusy(false);
    }
  }

  async function checkConfig() {
    setChecking(true);
    setFeedback(null);
    try {
      const res = await api.checkSettings();
      const text = res.message || '配置校验通过，密钥格式正确';
      setFeedback({ type: 'success', text });
      message.success(text);
    } catch (e) {
      const text = (e as Error).message || '配置校验失败';
      setFeedback({ type: 'error', text });
      message.error(text);
    } finally {
      setChecking(false);
    }
  }

  async function saveEpay() {
    const v = await epayForm.validateFields();
    setEpayBusy(true);
    setEpayFeedback(null);
    try {
      const saved = await api.saveEpaySettings({
        enabled: v.enabled,
        gateway: v.gateway || '',
        pid: v.pid || '',
        key: v.key || '',
        channels: v.channels || [],
        paymentMethodLabels: {
          epay_alipay: v.label_epay_alipay || '',
          epay_wxpay: v.label_epay_wxpay || '',
          epay_qqpay: v.label_epay_qqpay || '',
        },
      });
      const res = await api.getSettings();
      const labels = res.paymentMethodLabels || {};
      if (res.epay) {
        setEpayEnabled(res.epay.enabled);
        setEpayConfigured(res.epay.configured);
        setEpayUnreadable(res.epay.unreadable);
        setEpayKeyMasked(res.epay.settings.keyMasked || '');
        epayForm.setFieldsValue({
          enabled: res.epay.enabled,
          gateway: res.epay.settings.gateway || '',
          pid: res.epay.settings.pid || '',
          key: '',
          channels: res.epay.settings.channels || [],
          label_epay_alipay: labels.epay_alipay || '',
          label_epay_wxpay: labels.epay_wxpay || '',
          label_epay_qqpay: labels.epay_qqpay || '',
        });
      }
      if (saved.warning) {
        const text = `配置已保存，但校验未通过：${saved.warning}`;
        setEpayFeedback({ type: 'warning', text });
        message.warning(text);
      } else {
        const text = v.enabled ? '易支付配置已保存' : '已关闭易支付收款';
        setEpayFeedback({ type: 'success', text });
        message.success(text);
      }
    } catch (e) {
      const text = (e as Error).message || '保存失败，请稍后重试';
      setEpayFeedback({ type: 'error', text });
      message.error(text);
    } finally {
      setEpayBusy(false);
    }
  }

  async function checkEpay() {
    setEpayChecking(true);
    setEpayFeedback(null);
    try {
      const res = await api.checkEpaySettings();
      const text = res.message || '配置校验通过';
      setEpayFeedback({ type: 'success', text });
      message.success(text);
    } catch (e) {
      const text = (e as Error).message || '配置校验失败';
      setEpayFeedback({ type: 'error', text });
      message.error(text);
    } finally {
      setEpayChecking(false);
    }
  }

  function syncEvmAddress(fromId: (typeof USDT_CHAINS)[number]['id']) {
    const addr = String(usdtForm.getFieldValue(`net_${fromId}_address`) || '').trim();
    if (!usdtAddressLooksValid(fromId, addr)) {
      message.warning('请先填写有效的 0x 收款地址，再同步到其他 EVM 链');
      return;
    }
    const patch: Record<string, unknown> = {};
    let filled = 0;
    let skipped = 0;
    for (const ch of USDT_CHAINS) {
      if (!ch.evm || ch.id === fromId) continue;
      const existing = String(usdtForm.getFieldValue(`net_${ch.id}_address`) || '').trim();
      if (existing) {
        skipped += 1;
        continue;
      }
      patch[`net_${ch.id}_address`] = addr;
      patch[`net_${ch.id}_enabled`] = true;
      filled += 1;
    }
    if (filled) usdtForm.setFieldsValue(patch);
    if (filled) {
      message.success(
        skipped
          ? `已填入 ${filled} 条尚未填写的 EVM 链（已有地址的未改动），保存后才会开通。`
          : `已填入其余 ${filled} 条 EVM 链，保存后才会开通。`,
      );
    } else {
      message.info('其他 EVM 链已有地址，未作修改。');
    }
  }

  async function saveUsdt() {
    const v = await usdtForm.validateFields();
    setUsdtBusy(true);
    setUsdtFeedback(null);
    try {
      const labels: Record<string, string> = {};
      const networks = USDT_CHAINS.map((ch) => {
        labels[ch.channel] = String(v[`net_${ch.id}_label`] || '');
        return {
          id: ch.id,
          enabled: Boolean(v[`net_${ch.id}_enabled`]),
          address: String(v[`net_${ch.id}_address`] || ''),
          apiKey: String(v[`net_${ch.id}_apiKey`] || ''),
        };
      });
      const saved = await api.saveUsdtSettings({
        enabled: Boolean(v.enabled),
        rate: String(v.rate || ''),
        expireMinutes: Number(v.expireMinutes || 15),
        networks,
        paymentMethodLabels: labels,
      });
      const res = await api.getSettings();
      if (res.usdt) {
        setUsdtEnabled(res.usdt.enabled);
        setUsdtConfigured(res.usdt.configured);
        setUsdtUnreadable(res.usdt.unreadable);
        const nets = res.usdt.settings.networks || [];
        const masks: Record<string, string> = {};
        const fields: Record<string, unknown> = {
          enabled: res.usdt.enabled,
          rate: res.usdt.settings.rate || DEFAULT_USDT_RATE,
          expireMinutes: res.usdt.settings.expireMinutes || 15,
        };
        const savedLabels = res.paymentMethodLabels || {};
        const readyIds: string[] = [];
        for (const ch of USDT_CHAINS) {
          const n = nets.find((x) => x.id === ch.id);
          const address = n?.address || '';
          const enabled = Boolean(n?.enabled && address);
          fields[`net_${ch.id}_enabled`] = enabled;
          fields[`net_${ch.id}_address`] = address;
          fields[`net_${ch.id}_apiKey`] = '';
          fields[`net_${ch.id}_label`] = savedLabels[ch.channel] || '';
          if (enabled) readyIds.push(ch.id);
          if (n?.apiKeyMasked) masks[ch.id] = n.apiKeyMasked;
        }
        setUsdtKeyMasks(masks);
        setUsdtReadyIds(readyIds);
        usdtForm.setFieldsValue(fields);
      }
      if (saved.warning) {
        const text = `配置已保存，但校验未通过：${saved.warning}`;
        setUsdtFeedback({ type: 'warning', text });
        message.warning(text);
      } else {
        const text =
          saved.message ||
          (v.enabled ? 'USDT 收款配置已保存' : '已关闭 USDT 收款，已填写的地址和汇率已保留。');
        setUsdtFeedback({ type: 'success', text });
        message.success(text);
      }
    } catch (e) {
      const text = (e as Error).message || '保存失败，请稍后重试';
      setUsdtFeedback({ type: 'error', text });
      message.error(text);
    } finally {
      setUsdtBusy(false);
    }
  }

  async function checkUsdt() {
    setUsdtChecking(true);
    setUsdtFeedback(null);
    try {
      const res = await api.checkUsdtSettings();
      const text = res.message || '配置校验通过';
      setUsdtFeedback({ type: 'success', text });
      message.success(text);
    } catch (e) {
      const text = (e as Error).message || '配置校验失败';
      setUsdtFeedback({ type: 'error', text });
      message.error(text);
    } finally {
      setUsdtChecking(false);
    }
  }

  return (
    <div style={{ maxWidth: 880 }}>
      <Typography.Title level={3}>收款配置</Typography.Title>
      <Typography.Paragraph type="secondary">
        可只开通支付宝当面付，也可额外或单独开通易支付、USDT。多种方式都配置时，买家结账可按管理员设定的名称自行选择。站点用 HTTPS 域名访问时，系统会按当前域名自动设置异步通知地址，一般不必再填。
      </Typography.Paragraph>

      <Tabs
        activeKey={payTab}
        onChange={setPayTab}
        items={[
          {
            key: 'alipay',
            label: (
              <span>
                支付宝当面付
                {configured ? (
                  <Tag color="success" style={{ marginLeft: 8 }}>
                    已配置
                  </Tag>
                ) : (
                  <Tag style={{ marginLeft: 8 }}>未配置</Tag>
                )}
              </span>
            ),
            children: (
              <>
                <Typography.Paragraph type="secondary">
                  填写 AppId、应用私钥（商户密钥）和支付宝公钥（商户 key）即可使用官方当面付收款。
                </Typography.Paragraph>
                {unreadable ? (
                  <Alert
                    type="error"
                    showIcon
                    style={{ marginBottom: 16 }}
                    message="已保存的密钥无法读取，请重新填写并保存支付宝配置"
                  />
                ) : configured ? (
                  <Alert
                    type="success"
                    showIcon
                    style={{ marginBottom: 16 }}
                    message="已配置当面付"
                    description={`私钥 ${masked.priv} · 公钥 ${masked.pub}（留空表示不修改）`}
                  />
                ) : (
                  <Alert
                    type="warning"
                    showIcon
                    style={{ marginBottom: 16 }}
                    message={
                      epayConfigured || usdtConfigured
                        ? '尚未配置当面付。已开通其他收款方式，店铺仍可收款。'
                        : '尚未配置当面付'
                    }
                  />
                )}
                {feedback && (
                  <Alert
                    type={feedback.type}
                    showIcon
                    style={{ marginBottom: 16 }}
                    message={feedback.text}
                  />
                )}
                <Form form={form} layout="vertical" onFinish={save}>
                  <Form.Item
                    name="buyerLabel"
                    label="买家可见名称"
                    extra="买家结账时看到的名称。不填则显示「支付宝」。例如设置为「官方渠道」，可与其他支付宝通道区分。"
                  >
                    <Input placeholder="例如：官方渠道" maxLength={20} size="large" />
                  </Form.Item>
                  <Form.Item
                    name="appId"
                    label="AppId"
                    rules={[{ required: true, message: '请填写 AppId' }]}
                  >
                    <Input placeholder="开放平台应用 AppId" size="large" />
                  </Form.Item>
                  <Form.Item
                    name="privateKey"
                    label="应用私钥"
                    extra="填写商户密钥，不要把公钥填到这里。"
                    rules={configured ? [] : [{ required: true, message: '请填写私钥' }]}
                  >
                    <Input.TextArea
                      rows={4}
                      placeholder={configured ? '已保存，留空则不修改' : '商户密钥（RSA2 应用私钥）'}
                    />
                  </Form.Item>
                  <Form.Item
                    name="alipayPublicKey"
                    label="支付宝公钥"
                    extra="填写商户 key / 支付宝公钥，不要填写应用公钥。"
                    rules={configured ? [] : [{ required: true, message: '请填写公钥' }]}
                  >
                    <Input.TextArea
                      rows={4}
                      placeholder={
                        configured ? '已保存，留空则不修改' : '商户 key / 支付宝公钥（不要填应用公钥）'
                      }
                    />
                  </Form.Item>
                  <Form.Item name="gateway" label="网关" rules={[{ required: true }]}>
                    <Select
                      options={[
                        { value: PROD, label: '正式环境' },
                        { value: SANDBOX, label: '沙箱环境' },
                      ]}
                    />
                  </Form.Item>
                  <Form.Item name="sellerId" label="收款账号 seller_id（可选）">
                    <Input placeholder="用于核对异步通知中的 seller_id，不填则跳过该项核对" />
                  </Form.Item>
                  <Form.Item name="storeId" label="门店编号 store_id（可选）">
                    <Input />
                  </Form.Item>
                  <Form.Item
                    name="notifyUrl"
                    label="异步通知 URL"
                    extra="通常不用填。用 HTTPS 域名访问店铺时，会自动使用当前域名下的 /api/payment/notify，例如 https://pay.example.com/api/payment/notify。只有访问域名和收款域名不一致时才需要手动填写。"
                  >
                    <Input placeholder="https://你的域名/api/payment/notify" />
                  </Form.Item>
                  <Button type="primary" htmlType="submit" className="candy-btn" loading={busy} size="large">
                    保存配置
                  </Button>
                  <Button
                    style={{ marginLeft: 12 }}
                    loading={checking}
                    disabled={busy}
                    onClick={() => void checkConfig()}
                    size="large"
                  >
                    检测配置
                  </Button>
                </Form>
              </>
            ),
          },
          {
            key: 'epay',
            label: (
              <span>
                易支付
                {epayConfigured ? (
                  <Tag color="success" style={{ marginLeft: 8 }}>
                    已启用
                  </Tag>
                ) : (
                  <Tag style={{ marginLeft: 8 }}>未启用</Tag>
                )}
              </span>
            ),
            children: (
              <>
                <Typography.Paragraph type="secondary">
                  适用于兼容彩虹易支付 V1 接口（mapi.php）的支付网关。不开启时不影响已配置的支付宝当面付。启用后请填写支付网关、商户ID、商户密钥，并勾选要开通的渠道。用 HTTPS 域名访问店铺时，系统会自动登记异步通知地址，无需手填；HTTP 访问时将改由买家页面轮询确认支付结果。
                </Typography.Paragraph>
                {epayUnreadable ? (
                  <Alert
                    type="error"
                    showIcon
                    style={{ marginBottom: 16 }}
                    message="已保存的商户密钥无法读取，请重新填写并保存"
                  />
                ) : epayConfigured ? (
                  <Alert
                    type="success"
                    showIcon
                    style={{ marginBottom: 16 }}
                    message="已启用易支付"
                    description={epayKeyMasked ? `商户密钥 ${epayKeyMasked}（留空表示不修改）` : undefined}
                  />
                ) : epayEnabled ? (
                  <Alert
                    type="warning"
                    showIcon
                    style={{ marginBottom: 16 }}
                    message="已打开开关，但配置尚不完整，买家还不能使用该收款方式"
                  />
                ) : (
                  <Alert
                    type="info"
                    showIcon
                    style={{ marginBottom: 16 }}
                    message="未启用。需要时打开开关并填写下列字段即可。"
                  />
                )}
                {epayFeedback && (
                  <Alert
                    type={epayFeedback.type}
                    showIcon
                    style={{ marginBottom: 16 }}
                    message={epayFeedback.text}
                  />
                )}
                <Form
                  form={epayForm}
                  layout="vertical"
                  onFinish={saveEpay}
                  initialValues={{ enabled: false, channels: [] }}
                >
                  <Form.Item name="enabled" label="启用易支付收款" valuePropName="checked">
                    <Switch
                      checkedChildren="已启用"
                      unCheckedChildren="未启用"
                      onChange={(v) => setEpayEnabled(v)}
                    />
                  </Form.Item>
                  <Form.Item
                    name="gateway"
                    label="支付网关"
                    extra="填写支付平台提供的网关根地址，例如 https://pay.example.com/"
                    rules={epayEnabled ? [{ required: true, message: '请填写支付网关' }] : []}
                  >
                    <Input placeholder="https://pay.example.com/" size="large" />
                  </Form.Item>
                  <Form.Item
                    name="pid"
                    label="商户ID"
                    rules={epayEnabled ? [{ required: true, message: '请填写商户ID' }] : []}
                  >
                    <Input placeholder="平台分配的商户 ID" size="large" />
                  </Form.Item>
                  <Form.Item
                    name="key"
                    label="商户密钥"
                    extra="密钥不会以明文回显。已保存过的密钥留空表示不修改。"
                    rules={
                      epayConfigured || !epayEnabled
                        ? []
                        : [{ required: true, message: '请填写商户密钥' }]
                    }
                  >
                    <Input.Password
                      size="large"
                      visibilityToggle={false}
                      placeholder={epayKeyMasked ? '已保存，留空则不修改' : '平台分配的商户密钥'}
                      autoComplete="new-password"
                    />
                  </Form.Item>
                  <Form.Item
                    name="channels"
                    label="开通渠道"
                    rules={
                      epayEnabled
                        ? [{ required: true, type: 'array', min: 1, message: '请至少选择一个渠道' }]
                        : []
                    }
                  >
                    <Checkbox.Group options={EPAY_CHANNEL_OPTIONS} />
                  </Form.Item>
                  {epayChannels.includes('alipay') && (
                    <Form.Item
                      name="label_epay_alipay"
                      label="支付宝买家可见名称"
                      extra="与官方当面付同时开通时，买家会看到两个选项。例如设置为「慢速通道」。不填则显示「支付宝」。"
                    >
                      <Input placeholder="例如：慢速通道" maxLength={20} size="large" />
                    </Form.Item>
                  )}
                  {epayChannels.includes('wxpay') && (
                    <Form.Item
                      name="label_epay_wxpay"
                      label="微信买家可见名称"
                      extra="不填则显示「微信」。"
                    >
                      <Input placeholder="例如：微信" maxLength={20} size="large" />
                    </Form.Item>
                  )}
                  {epayChannels.includes('qqpay') && (
                    <Form.Item
                      name="label_epay_qqpay"
                      label="QQ 钱包买家可见名称"
                      extra="不填则显示「QQ钱包」。"
                    >
                      <Input placeholder="例如：QQ钱包" maxLength={20} size="large" />
                    </Form.Item>
                  )}
                  <Button type="primary" htmlType="submit" className="candy-btn" loading={epayBusy} size="large">
                    保存易支付配置
                  </Button>
                  <Button
                    style={{ marginLeft: 12 }}
                    loading={epayChecking}
                    disabled={epayBusy}
                    onClick={() => void checkEpay()}
                    size="large"
                  >
                    检测配置
                  </Button>
                </Form>
              </>
            ),
          },
          {
            key: 'usdt',
            label: (
              <span>
                USDT
                {usdtConfigured ? (
                  <Tag color="success" style={{ marginLeft: 8 }}>
                    已启用
                  </Tag>
                ) : (
                  <Tag style={{ marginLeft: 8 }}>未启用</Tag>
                )}
              </span>
            ),
            children: (
              <>
                <Typography.Paragraph type="secondary" style={{ marginBottom: 10 }}>
                  打开「启用 USDT 收款」，填写汇率，再把你钱包在对应链上的 USDT 收款地址填进去并保存即可。不必另外部署收款程序，也不必填写回调。买家选择网络、按精确金额付款后，系统会自动查链发卡。请填写你自己的钱包地址，不要用交易所充值地址（无法按唯一金额对账）。查询 API Key 可选，不是收款必要条件。
                </Typography.Paragraph>
                {usdtScanHint ? (
                  <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: -4 }}>
                    {usdtScanHint}
                  </Typography.Paragraph>
                ) : null}
                {usdtUnreadable ? (
                  <Alert
                    type="error"
                    showIcon
                    style={{ marginBottom: 12 }}
                    message="已保存的查询 API Key 无法读取，请重新填写并保存。不影响已填写的收款地址。"
                  />
                ) : usdtConfigured ? (
                  <Alert
                    type="success"
                    showIcon
                    style={{ marginBottom: 12 }}
                    message={
                      usdtReadyIds.length
                        ? `已开通 USDT 收款：${USDT_CHAINS.filter((c) => usdtReadyIds.includes(c.id)).map((c) => c.short).join('、')}。买家结账时可选择这些网络。`
                        : '已启用 USDT 收款'
                    }
                  />
                ) : usdtEnabled ? (
                  <Alert
                    type="warning"
                    showIcon
                    style={{ marginBottom: 12 }}
                    message="已打开总开关，但还没有可收款的链。请至少填写一条链的有效地址并保存。"
                  />
                ) : (
                  <Alert
                    type="info"
                    showIcon
                    style={{ marginBottom: 12 }}
                    message={
                      usdtReadyIds.length
                        ? `总开关已关闭。已保存的链：${USDT_CHAINS.filter((c) => usdtReadyIds.includes(c.id)).map((c) => c.short).join('、')}。打开总开关并保存即可对外收款。`
                        : '未启用。打开总开关，确认汇率，填写至少一条链的收款地址并保存即可收款。'
                    }
                  />
                )}
                {usdtFeedback && (
                  <Alert
                    type={usdtFeedback.type}
                    showIcon
                    style={{ marginBottom: 12 }}
                    message={usdtFeedback.text}
                  />
                )}
                <Form
                  form={usdtForm}
                  layout="vertical"
                  onFinish={saveUsdt}
                  initialValues={{ enabled: false, rate: DEFAULT_USDT_RATE, expireMinutes: 15 }}
                >
                  <div
                    style={{
                      display: 'flex',
                      gap: 16,
                      flexWrap: 'wrap',
                      alignItems: 'flex-start',
                      marginBottom: 4,
                    }}
                  >
                    <Form.Item
                      name="enabled"
                      label="启用 USDT 收款"
                      valuePropName="checked"
                      style={{ marginBottom: 8 }}
                    >
                      <Switch
                        checkedChildren="已启用"
                        unCheckedChildren="未启用"
                        onChange={(v) => setUsdtEnabled(v)}
                      />
                    </Form.Item>
                    <Form.Item
                      name="rate"
                      label="1 USDT = 多少人民币"
                      extra="默认预填 7.20，请按行情自行修改。系统不会自动更新汇率。"
                      rules={usdtEnabled ? [{ required: true, message: '请填写汇率' }] : []}
                      style={{ flex: '1 1 240px', minWidth: 220, marginBottom: 8 }}
                    >
                      <Input placeholder="7.20" />
                    </Form.Item>
                    <Form.Item
                      name="expireMinutes"
                      label="有效期（分钟）"
                      extra="默认 15 分钟，到期后释放卡密和金额。"
                      rules={[{ required: true, message: '请填写有效期' }]}
                      style={{ width: 168, marginBottom: 8 }}
                    >
                      <InputNumber min={5} max={180} style={{ width: '100%' }} />
                    </Form.Item>
                  </div>
                  <div style={{ fontWeight: 600, margin: '4px 0' }}>收款链</div>
                  <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 8 }}>
                    点选一条链后填写地址。填了有效地址并保存即开通该链，去掉地址并保存即可停用。买家可见名称和查询 API Key 在高级设置中。
                  </Typography.Paragraph>
                  <Form.Item noStyle shouldUpdate>
                    {() => {
                      const selected =
                        USDT_CHAINS.find((c) => c.id === usdtSelectedChain) || USDT_CHAINS[0];
                      const draftNames = USDT_CHAINS.filter((ch) =>
                        String(usdtForm.getFieldValue(`net_${ch.id}_address`) || '').trim(),
                      ).map((ch) => ch.short);
                      return (
                        <>
                          <div style={{ marginBottom: 8, fontSize: 13, color: 'rgba(0,0,0,.65)' }}>
                            {draftNames.length
                              ? `当前已填写：${draftNames.join('、')}${usdtReadyIds.length ? '' : '（保存后才会对外生效）'}`
                              : '尚未填写任何收款地址'}
                          </div>
                          <div
                            style={{
                              display: 'flex',
                              gap: 12,
                              alignItems: 'stretch',
                              flexWrap: 'wrap',
                            }}
                          >
                            <div
                              style={{
                                flex: '0 0 228px',
                                minWidth: 200,
                                border: '1px solid var(--ant-color-border-secondary, #f0f0f0)',
                                borderRadius: 8,
                                overflow: 'hidden',
                                alignSelf: 'flex-start',
                              }}
                            >
                              {USDT_CHAINS.map((ch) => {
                                const addr = String(
                                  usdtForm.getFieldValue(`net_${ch.id}_address`) || '',
                                ).trim();
                                const savedOn = usdtReadyIds.includes(ch.id) && Boolean(addr);
                                const draftOn = Boolean(addr);
                                const active = ch.id === selected.id;
                                const status = savedOn
                                  ? usdtConfigured
                                    ? '已开通'
                                    : '已保存'
                                  : draftOn
                                    ? '已填写'
                                    : '未开通';
                                const color = savedOn
                                  ? usdtConfigured
                                    ? 'success'
                                    : 'blue'
                                  : draftOn
                                    ? 'processing'
                                    : 'default';
                                return (
                                  <button
                                    type="button"
                                    key={ch.id}
                                    onClick={() => setUsdtSelectedChain(ch.id)}
                                    style={{
                                      display: 'flex',
                                      width: '100%',
                                      alignItems: 'center',
                                      justifyContent: 'space-between',
                                      gap: 8,
                                      padding: '6px 10px',
                                      border: 'none',
                                      borderBottom:
                                        '1px solid var(--ant-color-border-secondary, #f5f5f5)',
                                      background: active ? '#e6f4ff' : 'transparent',
                                      cursor: 'pointer',
                                      textAlign: 'left',
                                      font: 'inherit',
                                      lineHeight: 1.25,
                                    }}
                                  >
                                    <span>
                                      <span style={{ fontWeight: 600 }}>{ch.short}</span>
                                      <span
                                        style={{
                                          display: 'block',
                                          fontSize: 11,
                                          color: 'rgba(0,0,0,.45)',
                                        }}
                                      >
                                        {ch.title}
                                      </span>
                                    </span>
                                    <Tag color={color} style={{ margin: 0, flexShrink: 0 }}>
                                      {status}
                                    </Tag>
                                  </button>
                                );
                              })}
                            </div>
                            <div
                              style={{
                                flex: '1 1 320px',
                                minWidth: 280,
                                border: '1px solid var(--ant-color-border-secondary, #f0f0f0)',
                                borderRadius: 8,
                                padding: '12px 14px',
                              }}
                            >
                              {USDT_CHAINS.map((ch) => (
                                <div
                                  key={ch.id}
                                  style={{ display: ch.id === selected.id ? 'block' : 'none' }}
                                >
                                  <div style={{ fontWeight: 600, marginBottom: 6 }}>{ch.title}</div>
                                  <Form.Item
                                    name={`net_${ch.id}_enabled`}
                                    valuePropName="checked"
                                    hidden
                                  >
                                    <Switch />
                                  </Form.Item>
                                  <Form.Item
                                    name={`net_${ch.id}_address`}
                                    label="收款地址"
                                    extra={ch.extra}
                                    style={{ marginBottom: 8 }}
                                  >
                                    <Input
                                      placeholder={ch.placeholder}
                                      onChange={(e) => {
                                        const v = e.target.value || '';
                                        usdtForm.setFieldValue(
                                          `net_${ch.id}_enabled`,
                                          Boolean(v.trim()),
                                        );
                                      }}
                                    />
                                  </Form.Item>
                                  {ch.evm ? (
                                    <Button
                                      type="link"
                                      size="small"
                                      style={{ padding: 0, height: 'auto', marginBottom: 8 }}
                                      onClick={() => syncEvmAddress(ch.id)}
                                    >
                                      同步到其他尚未填写的 EVM 链
                                    </Button>
                                  ) : null}
                                  <Collapse
                                    ghost
                                    size="small"
                                    items={[
                                      {
                                        key: 'advanced',
                                        label: '高级设置',
                                        children: (
                                          <>
                                            <Form.Item
                                              name={`net_${ch.id}_label`}
                                              label="买家可见名称"
                                              extra="不填则显示默认名称，例如 USDT (TRC20)、USDT (BEP20)、USDT (X Layer)。"
                                              style={{ marginBottom: 8 }}
                                            >
                                              <Input
                                                placeholder="买家结账时看到的名称"
                                                maxLength={20}
                                              />
                                            </Form.Item>
                                            <Form.Item
                                              name={`net_${ch.id}_apiKey`}
                                              label="查询 API Key（可选）"
                                              extra="不是收款必要条件。不填也可使用预置官方接口。已保存的密钥不会回显明文，留空表示不修改。"
                                              style={{ marginBottom: 0 }}
                                            >
                                              <Input.Password
                                                visibilityToggle={false}
                                                placeholder={
                                                  usdtKeyMasks[ch.id]
                                                    ? '已保存，留空则不修改'
                                                    : '可选'
                                                }
                                                autoComplete="new-password"
                                              />
                                            </Form.Item>
                                          </>
                                        ),
                                      },
                                    ]}
                                  />
                                </div>
                              ))}
                            </div>
                          </div>
                        </>
                      );
                    }}
                  </Form.Item>
                  <div style={{ marginTop: 16 }}>
                    <Button type="primary" htmlType="submit" className="candy-btn" loading={usdtBusy}>
                      保存 USDT 配置
                    </Button>
                    <Button
                      style={{ marginLeft: 12 }}
                      loading={usdtChecking}
                      disabled={usdtBusy}
                      onClick={() => void checkUsdt()}
                    >
                      检测配置
                    </Button>
                  </div>
                </Form>
              </>
            ),
          },
        ]}
      />
    </div>
  );
}
