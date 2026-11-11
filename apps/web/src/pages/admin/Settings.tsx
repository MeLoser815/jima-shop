import { useEffect, useState } from 'react';
import { Alert, App, Button, Form, Input, Select, Typography } from 'antd';
import { api } from '../../api';

const SANDBOX = 'https://openapi-sandbox.dl.alipaydev.com/gateway.do';
const PROD = 'https://openapi.alipay.com/gateway.do';

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
  const [masked, setMasked] = useState({ priv: '', pub: '' });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .getSettings()
      .then((res) => {
        setConfigured(res.configured);
        setMasked({
          priv: res.settings.privateKeyMasked,
          pub: res.settings.alipayPublicKeyMasked,
        });
        form.setFieldsValue({
          appId: res.settings.appId || '',
          gateway: res.settings.gateway || PROD,
          storeId: res.settings.storeId || '',
          sellerId: res.settings.sellerId || '',
          notifyUrl: res.settings.notifyUrl || '',
          privateKey: '',
          alipayPublicKey: '',
        });
      })
      .catch((e) => message.error((e as Error).message));
  }, [form, message]);

  async function save() {
    const v = await form.validateFields();
    setBusy(true);
    try {
      await api.saveSettings({
        appId: v.appId,
        privateKey: v.privateKey || '',
        alipayPublicKey: v.alipayPublicKey || '',
        gateway: v.gateway,
        storeId: v.storeId,
        sellerId: v.sellerId,
        notifyUrl: v.notifyUrl,
      });
      message.success('收款配置已保存');
      const res = await api.getSettings();
      setConfigured(res.configured);
      setMasked({
        priv: res.settings.privateKeyMasked,
        pub: res.settings.alipayPublicKeyMasked,
      });
      form.setFieldsValue({ privateKey: '', alipayPublicKey: '' });
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 720 }}>
      <Typography.Title level={3}>支付宝收款配置</Typography.Title>
      <Typography.Paragraph type="secondary">
        填好 AppId、应用私钥、支付宝公钥后，前台结账即可走当面付收款码。
      </Typography.Paragraph>
      {configured ? (
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
          rules={configured ? [] : [{ required: true, message: '请填写私钥' }]}
        >
          <Input.TextArea
            rows={4}
            placeholder={configured ? '已保存，留空则不修改' : 'RSA2 应用私钥'}
          />
        </Form.Item>
        <Form.Item
          name="alipayPublicKey"
          label="支付宝公钥"
          rules={configured ? [] : [{ required: true, message: '请填写公钥' }]}
        >
          <Input.TextArea
            rows={4}
            placeholder={configured ? '已保存，留空则不修改' : '支付宝公钥（非应用公钥）'}
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
        <Form.Item name="notifyUrl" label="异步通知 URL">
          <Input placeholder="公网可访问的 /api/payment/notify" />
        </Form.Item>
        <Button type="primary" htmlType="submit" className="candy-btn" loading={busy} size="large">
          保存配置
        </Button>
      </Form>
    </div>
  );
}
