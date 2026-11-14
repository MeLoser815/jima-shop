import { useEffect, useState } from 'react';
import {
  Alert,
  App,
  Button,
  Checkbox,
  Divider,
  Form,
  Input,
  Select,
  Switch,
  Typography,
} from 'antd';
import { api } from '../../api';

const SANDBOX = 'https://openapi-sandbox.dl.alipaydev.com/gateway.do';
const PROD = 'https://openapi.alipay.com/gateway.do';

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
};

type EpayFormVals = {
  enabled: boolean;
  gateway: string;
  pid: string;
  key: string;
  channels: string[];
};

export default function Settings() {
  const { message } = App.useApp();
  const [form] = Form.useForm<FormVals>();
  const [epayForm] = Form.useForm<EpayFormVals>();
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
        form.setFieldsValue({
          appId: res.settings.appId || '',
          gateway: res.settings.gateway || PROD,
          storeId: res.settings.storeId || '',
          sellerId: res.settings.sellerId || '',
          notifyUrl: res.settings.notifyUrl || suggestedNotifyUrl(),
          privateKey: '',
          alipayPublicKey: '',
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
          });
        }
      })
      .catch((e) => message.error((e as Error).message));
  }, [form, epayForm, message]);

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
      });
      const res = await api.getSettings();
      setConfigured(res.configured);
      setUnreadable(Boolean(res.unreadable));
      setMasked({
        priv: res.settings.privateKeyMasked,
        pub: res.settings.alipayPublicKeyMasked,
      });
      form.setFieldsValue({ privateKey: '', alipayPublicKey: '' });
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
      });
      const res = await api.getSettings();
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

  return (
    <div style={{ maxWidth: 720 }}>
      <Typography.Title level={3}>收款配置</Typography.Title>
      <Typography.Paragraph type="secondary">
        可只开通支付宝当面付，也可额外或单独开通易支付。两种方式都配置时，买家结账可按已开通渠道选择。站点用 HTTPS 域名访问时，系统会按当前域名自动设置异步通知地址，一般不必再填。
      </Typography.Paragraph>

      <Typography.Title level={4}>支付宝当面付</Typography.Title>
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
            epayConfigured
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
            placeholder={configured ? '已保存，留空则不修改' : '商户 key / 支付宝公钥（不要填应用公钥）'}
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

      <Divider />

      <Typography.Title level={4}>易支付（可选）</Typography.Title>
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
        <Form.Item
          name="enabled"
          label="启用易支付收款"
          valuePropName="checked"
        >
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
          rules={
            epayEnabled
              ? [{ required: true, message: '请填写支付网关' }]
              : []
          }
        >
          <Input placeholder="https://pay.example.com/" size="large" />
        </Form.Item>
        <Form.Item
          name="pid"
          label="商户ID"
          rules={
            epayEnabled ? [{ required: true, message: '请填写商户ID' }] : []
          }
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
        <Button
          type="primary"
          htmlType="submit"
          className="candy-btn"
          loading={epayBusy}
          size="large"
        >
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
    </div>
  );
}
