import { useEffect, useState } from 'react';
import { Alert, App, Button, Form, Input, Select, Typography } from 'antd';
import { api } from '../../api';

const SANDBOX = 'https://openapi-sandbox.dl.alipaydev.com/gateway.do';
const PROD = 'https://openapi.alipay.com/gateway.do';

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

export default function Settings() {
  const { message } = App.useApp();
  const [form] = Form.useForm<FormVals>();
  const [configured, setConfigured] = useState(false);
  const [unreadable, setUnreadable] = useState(false);
  const [masked, setMasked] = useState({ priv: '', pub: '' });
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [feedback, setFeedback] = useState<{
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
      })
      .catch((e) => message.error((e as Error).message));
  }, [form, message]);

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

  return (
    <div style={{ maxWidth: 720 }}>
      <Typography.Title level={3}>支付宝收款配置</Typography.Title>
      <Typography.Paragraph type="secondary">
        在此填写 AppId、应用私钥（商户密钥）和支付宝公钥（商户 key）即可收款。站点用 HTTPS 域名访问时，系统会按当前域名自动设置支付宝回调地址，一般不必再填。
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
          message="尚未配置，店铺暂时无法收款"
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
    </div>
  );
}
