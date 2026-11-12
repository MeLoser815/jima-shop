import { useEffect, useState } from 'react';
import { App, Button, Divider, Form, Input, Typography } from 'antd';
import { api, setToken } from '../../api';
import { ADMIN_BASE_PATH } from '../../adminPath';

export default function Account() {
  const { message } = App.useApp();
  const [passwordForm] = Form.useForm();
  const [pathForm] = Form.useForm();
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [pathBusy, setPathBusy] = useState(false);
  const [envLocked, setEnvLocked] = useState(false);

  useEffect(() => {
    api
      .getAdminPath()
      .then((res) => {
        setEnvLocked(res.envLocked);
        pathForm.setFieldsValue({ path: res.path });
      })
      .catch((e) => message.error((e as Error).message));
  }, [pathForm, message]);

  async function submitPassword() {
    const v = await passwordForm.validateFields();
    if (v.newPassword !== v.confirm) {
      message.error('两次新密码不一致');
      return;
    }
    setPasswordBusy(true);
    try {
      await api.changePassword(v.currentPassword, v.newPassword);
      message.success('密码已修改，请重新登录');
      passwordForm.resetFields();
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
      setPasswordBusy(false);
    }
  }

  async function submitPath() {
    const v = await pathForm.validateFields();
    const next = (v.path as string).trim();
    if (next === ADMIN_BASE_PATH) {
      message.info('与当前路径相同，无需修改');
      return;
    }
    setPathBusy(true);
    try {
      const res = await api.updateAdminPath(next);
      message.success(`后台路径已改为 ${res.path}，正在跳转`);
      window.location.assign(res.path);
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setPathBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 480 }}>
      <Typography.Title level={3}>账号安全</Typography.Title>
      <Typography.Paragraph type="secondary">
        修改登录密码后，所有已登录会话都会立即失效，需要重新登录。
      </Typography.Paragraph>
      <Form form={passwordForm} layout="vertical" onFinish={submitPassword}>
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
          loading={passwordBusy}
        >
          保存密码
        </Button>
      </Form>

      <Divider />

      <Typography.Title level={4}>后台访问路径</Typography.Title>
      <Typography.Paragraph type="secondary">
        默认路径 /admin 较容易被扫描。建议改成仅自己知道的单段路径，例如 /shop-manage。修改后请立即使用新地址访问，原路径将不再打开后台。
      </Typography.Paragraph>
      {envLocked ? (
        <Typography.Paragraph type="secondary">
          当前路径由环境变量 ADMIN_BASE_PATH 锁定，如需修改请更改该变量后重启服务。
        </Typography.Paragraph>
      ) : null}
      <Form form={pathForm} layout="vertical" onFinish={submitPath}>
        <Form.Item
          name="path"
          label="访问路径"
          rules={[
            { required: true, message: '请填写后台路径' },
            {
              pattern: /^\/[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/,
              message: '须为单个路径段，例如 /my-admin，仅限字母、数字、下划线和连字符',
            },
          ]}
        >
          <Input placeholder="/my-admin" disabled={envLocked} />
        </Form.Item>
        <Button
          type="primary"
          htmlType="submit"
          className="candy-btn"
          loading={pathBusy}
          disabled={envLocked}
        >
          保存路径
        </Button>
      </Form>
    </div>
  );
}
