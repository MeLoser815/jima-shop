import { useState } from 'react';
import { App, Button, Form, Input, Typography } from 'antd';
import { api, setToken } from '../../api';
import { ADMIN_BASE_PATH } from '../../adminPath';

export default function Account() {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [busy, setBusy] = useState(false);

  async function submit() {
    const v = await form.validateFields();
    if (v.newPassword !== v.confirm) {
      message.error('两次新密码不一致');
      return;
    }
    setBusy(true);
    try {
      await api.changePassword(v.currentPassword, v.newPassword);
      message.success('密码已修改，请重新登录');
      form.resetFields();
      try {
        await api.logout();
      } catch {
        /* 会话已作废 */
      }
      setToken(null);
      window.location.assign(ADMIN_BASE_PATH);
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 480 }}>
      <Typography.Title level={3}>账号安全</Typography.Title>
      <Typography.Paragraph type="secondary">
        修改登录密码后，所有已登录会话都会立即失效，需要重新登录。
      </Typography.Paragraph>
      <Form form={form} layout="vertical" onFinish={submit}>
        <Form.Item
          name="currentPassword"
          label="当前密码"
          rules={[{ required: true }]}
        >
          <Input.Password />
        </Form.Item>
        <Form.Item
          name="newPassword"
          label="新密码"
          rules={[{ required: true, min: 8, message: '至少 8 位' }]}
        >
          <Input.Password />
        </Form.Item>
        <Form.Item
          name="confirm"
          label="确认新密码"
          rules={[{ required: true, min: 8, message: '至少 8 位' }]}
        >
          <Input.Password />
        </Form.Item>
        <Button
          type="primary"
          htmlType="submit"
          className="candy-btn"
          loading={busy}
        >
          保存密码
        </Button>
      </Form>
    </div>
  );
}
