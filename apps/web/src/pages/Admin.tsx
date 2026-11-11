import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  App,
  Button,
  Card,
  Col,
  Divider,
  Form,
  Input,
  Row,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
  Typography,
} from 'antd';
import {
  KeyOutlined,
  LockOutlined,
  LogoutOutlined,
  SafetyCertificateOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { api, getToken, setToken } from '../api';

const SANDBOX = 'https://openapi-sandbox.dl.alipaydev.com/gateway.do';
const PROD = 'https://openapi.alipay.com/gateway.do';

type SettingsForm = {
  appId: string;
  privateKey: string;
  alipayPublicKey: string;
  gateway: string;
  storeId: string;
  notifyUrl: string;
};

type OrderRow = {
  out_trade_no: string;
  total_amount: string;
  subject: string;
  status: string;
  created_at: string;
  trade_no: string | null;
};

export default function AdminPage() {
  const { message } = App.useApp();
  const [bootLoading, setBootLoading] = useState(true);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [authed, setAuthed] = useState(Boolean(getToken()));
  const [username, setUsername] = useState('');
  const [configured, setConfigured] = useState(false);
  const [masked, setMasked] = useState({ priv: '', pub: '' });
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [busy, setBusy] = useState(false);

  const [authForm] = Form.useForm();
  const [settingsForm] = Form.useForm<SettingsForm>();
  const [pwdForm] = Form.useForm();

  const initialSettings = useMemo<SettingsForm>(
    () => ({
      appId: '',
      privateKey: '',
      alipayPublicKey: '',
      gateway: PROD,
      storeId: '',
      notifyUrl: '',
    }),
    [],
  );

  async function checkBootstrap() {
    setBootLoading(true);
    try {
      const res = await api.bootstrap();
      setNeedsSetup(res.needsSetup);
      if (res.needsSetup) {
        setAuthed(false);
        setToken(null);
      }
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setBootLoading(false);
    }
  }

  async function loadDashboard() {
    try {
      const me = await api.me();
      setUsername(me.username);
      const res = await api.getSettings();
      setConfigured(res.configured);
      settingsForm.setFieldsValue({
        appId: res.settings.appId || '',
        gateway: res.settings.gateway || PROD,
        storeId: res.settings.storeId || '',
        notifyUrl: res.settings.notifyUrl || '',
        privateKey: '',
        alipayPublicKey: '',
      });
      setMasked({
        priv: res.settings.privateKeyMasked,
        pub: res.settings.alipayPublicKeyMasked,
      });
      const o = await api.listOrders();
      setOrders(o.orders);
    } catch (e) {
      setAuthed(false);
      setToken(null);
      message.error((e as Error).message);
    }
  }

  useEffect(() => {
    void checkBootstrap();
  }, []);

  useEffect(() => {
    if (authed && !needsSetup) void loadDashboard();
  }, [authed, needsSetup]);

  async function onSetup(values: { username: string; password: string; confirm: string }) {
    if (values.password !== values.confirm) {
      message.error('两次输入的密码不一致');
      return;
    }
    setBusy(true);
    try {
      const res = await api.setup(values.username, values.password);
      setToken(res.token);
      setUsername(res.username);
      setNeedsSetup(false);
      setAuthed(true);
      message.success('管理员已创建，欢迎使用');
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function onLogin(values: { username: string; password: string }) {
    setBusy(true);
    try {
      const res = await api.login(values.username, values.password);
      setToken(res.token);
      setUsername(res.username);
      setAuthed(true);
      message.success(`欢迎回来，${res.username}`);
    } catch (e) {
      const err = e as Error & { needsSetup?: boolean };
      if (err.needsSetup) {
        setNeedsSetup(true);
        setAuthed(false);
      }
      message.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function onSaveSettings(values: SettingsForm) {
    if (
      !configured &&
      (!values.privateKey?.trim() || !values.alipayPublicKey?.trim())
    ) {
      message.error('首次配置请粘贴完整的应用私钥与支付宝公钥');
      return;
    }
    setBusy(true);
    try {
      await api.saveSettings({
        appId: values.appId.trim(),
        privateKey: values.privateKey?.trim() || '',
        alipayPublicKey: values.alipayPublicKey?.trim() || '',
        gateway: values.gateway?.trim(),
        storeId: values.storeId?.trim(),
        notifyUrl: values.notifyUrl?.trim(),
      });
      message.success('已保存，当面付可一键使用');
      await loadDashboard();
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function onChangePassword(values: {
    currentPassword: string;
    newPassword: string;
    confirm: string;
  }) {
    if (values.newPassword !== values.confirm) {
      message.error('两次输入的新密码不一致');
      return;
    }
    setBusy(true);
    try {
      await api.changePassword(values.currentPassword, values.newPassword);
      message.success('密码已更新');
      pwdForm.resetFields();
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function logout() {
    setToken(null);
    setAuthed(false);
    setUsername('');
    authForm.resetFields();
  }

  if (bootLoading) {
    return (
      <div className="auth-stage">
        <Card className="auth-card" loading />
      </div>
    );
  }

  if (needsSetup) {
    return (
      <div className="auth-stage">
        <Card className="auth-card">
          <Space direction="vertical" size={4} style={{ width: '100%', marginBottom: 16 }}>
            <Typography.Title level={3} style={{ margin: 0 }}>
              <SafetyCertificateOutlined style={{ color: '#1677ff', marginRight: 8 }} />
              首次安装
            </Typography.Title>
            <Typography.Text type="secondary">
              请自行设置管理员账号与密码，之后用该账号登录后台
            </Typography.Text>
          </Space>
          <Form layout="vertical" onFinish={onSetup} requiredMark="optional">
            <Form.Item
              name="username"
              label="管理员用户名"
              rules={[
                { required: true, message: '请输入用户名' },
                { min: 3, message: '至少 3 位' },
              ]}
            >
              <Input prefix={<UserOutlined />} placeholder="例如 admin" size="large" autoFocus />
            </Form.Item>
            <Form.Item
              name="password"
              label="密码"
              rules={[
                { required: true, message: '请输入密码' },
                { min: 6, message: '至少 6 位' },
              ]}
            >
              <Input.Password prefix={<LockOutlined />} placeholder="至少 6 位" size="large" />
            </Form.Item>
            <Form.Item
              name="confirm"
              label="确认密码"
              dependencies={['password']}
              rules={[{ required: true, message: '请再次输入密码' }]}
            >
              <Input.Password prefix={<LockOutlined />} placeholder="再输一次" size="large" />
            </Form.Item>
            <Button type="primary" htmlType="submit" block size="large" loading={busy}>
              创建管理员并进入后台
            </Button>
          </Form>
        </Card>
      </div>
    );
  }

  if (!authed) {
    return (
      <div className="auth-stage">
        <Card className="auth-card">
          <Space direction="vertical" size={4} style={{ width: '100%', marginBottom: 16 }}>
            <Typography.Title level={3} style={{ margin: 0 }}>
              管理后台登录
            </Typography.Title>
            <Typography.Text type="secondary">
              使用你在首次安装时设置的账号密码登录
            </Typography.Text>
          </Space>
          <Form form={authForm} layout="vertical" onFinish={onLogin} requiredMark="optional">
            <Form.Item
              name="username"
              label="用户名"
              rules={[{ required: true, message: '请输入用户名' }]}
            >
              <Input prefix={<UserOutlined />} size="large" autoFocus />
            </Form.Item>
            <Form.Item
              name="password"
              label="密码"
              rules={[{ required: true, message: '请输入密码' }]}
            >
              <Input.Password prefix={<LockOutlined />} size="large" />
            </Form.Item>
            <Button type="primary" htmlType="submit" block size="large" loading={busy}>
              登录
            </Button>
          </Form>
        </Card>
      </div>
    );
  }

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card
        styles={{ body: { paddingBlock: 16 } }}
        title={
          <Space>
            <Typography.Text strong>欢迎，{username}</Typography.Text>
            <Tag color={configured ? 'success' : 'warning'}>
              {configured ? '支付宝已配置' : '尚未配置支付宝'}
            </Tag>
          </Space>
        }
        extra={
          <Button icon={<LogoutOutlined />} onClick={logout}>
            退出登录
          </Button>
        }
      >
        <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
          在下方填写 AppId、应用私钥、支付宝公钥即可一键接入当面付。密钥 AES 加密入库，页面不会回显明文。
        </Typography.Paragraph>
      </Card>

      <Card>
        <Tabs
          items={[
            {
              key: 'alipay',
              label: (
                <span>
                  <KeyOutlined /> 支付宝接入
                </span>
              ),
              children: (
                <Form
                  form={settingsForm}
                  layout="vertical"
                  initialValues={initialSettings}
                  onFinish={onSaveSettings}
                  requiredMark="optional"
                >
                  <Row gutter={16}>
                    <Col xs={24} md={12}>
                      <Form.Item
                        name="appId"
                        label="1. AppId"
                        rules={[{ required: true, message: '请填写 AppId' }]}
                      >
                        <Input placeholder="例如 2021000000000000" size="large" />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={12}>
                      <Form.Item name="gateway" label="网关环境">
                        <Select
                          size="large"
                          options={[
                            { value: PROD, label: '正式环境 openapi.alipay.com' },
                            { value: SANDBOX, label: '沙箱环境 openapi-sandbox' },
                          ]}
                        />
                      </Form.Item>
                    </Col>
                  </Row>
                  <Form.Item
                    name="privateKey"
                    label={
                      masked.priv
                        ? `2. 应用私钥（已保存 ${masked.priv}，留空则保持不变）`
                        : '2. 应用私钥（商户 RSA2 私钥）'
                    }
                    rules={configured ? [] : [{ required: true, message: '请粘贴应用私钥' }]}
                  >
                    <Input.TextArea
                      rows={5}
                      placeholder="粘贴私钥，可带或不带 -----BEGIN RSA PRIVATE KEY-----"
                      style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}
                    />
                  </Form.Item>
                  <Form.Item
                    name="alipayPublicKey"
                    label={
                      masked.pub
                        ? `3. 支付宝公钥（已保存 ${masked.pub}，留空则保持不变）`
                        : '3. 支付宝公钥（开放平台「支付宝公钥」，不是应用公钥）'
                    }
                    rules={configured ? [] : [{ required: true, message: '请粘贴支付宝公钥' }]}
                  >
                    <Input.TextArea
                      rows={5}
                      placeholder="粘贴支付宝公钥"
                      style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}
                    />
                  </Form.Item>
                  <Row gutter={16}>
                    <Col xs={24} md={12}>
                      <Form.Item name="storeId" label="门店号 store_id（可选）">
                        <Input placeholder="可选" />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={12}>
                      <Form.Item name="notifyUrl" label="异步通知 URL（公网可访问）">
                        <Input placeholder="https://your-domain.com/api/payment/notify" />
                      </Form.Item>
                    </Col>
                  </Row>
                  <Space>
                    <Button type="primary" htmlType="submit" loading={busy} size="large">
                      保存并启用当面付
                    </Button>
                    <Button onClick={() => void loadDashboard()} disabled={busy}>
                      刷新
                    </Button>
                  </Space>
                </Form>
              ),
            },
            {
              key: 'orders',
              label: '最近订单',
              children: (
                <>
                  <Alert
                    type="info"
                    showIcon
                    style={{ marginBottom: 16 }}
                    message="本地 SQLite 中的当面付订单，支付成功后会自动更新状态"
                  />
                  <Table
                    rowKey="out_trade_no"
                    dataSource={orders}
                    pagination={{ pageSize: 10 }}
                    locale={{ emptyText: '暂无订单' }}
                    columns={[
                      {
                        title: '商户单号',
                        dataIndex: 'out_trade_no',
                        render: (v: string) => <span className="mono">{v}</span>,
                      },
                      {
                        title: '金额',
                        dataIndex: 'total_amount',
                        width: 100,
                        render: (v: string) => `¥${v}`,
                      },
                      { title: '标题', dataIndex: 'subject' },
                      {
                        title: '状态',
                        dataIndex: 'status',
                        width: 140,
                        render: (s: string) => {
                          const color =
                            s === 'TRADE_SUCCESS' || s === 'TRADE_FINISHED'
                              ? 'success'
                              : s === 'TRADE_CLOSED' || s === 'FAILED'
                                ? 'error'
                                : 'processing';
                          return <Tag color={color}>{s}</Tag>;
                        },
                      },
                      { title: '时间', dataIndex: 'created_at', width: 180 },
                    ]}
                  />
                </>
              ),
            },
            {
              key: 'account',
              label: '账号安全',
              children: (
                <>
                  <Alert
                    type="warning"
                    showIcon
                    style={{ marginBottom: 16 }}
                    message="密码以 bcrypt 哈希保存在本地数据库，不会明文存储。"
                  />
                  <Form
                    form={pwdForm}
                    layout="vertical"
                    onFinish={onChangePassword}
                    style={{ maxWidth: 420 }}
                    requiredMark="optional"
                  >
                    <Form.Item
                      name="currentPassword"
                      label="当前密码"
                      rules={[{ required: true, message: '请输入当前密码' }]}
                    >
                      <Input.Password />
                    </Form.Item>
                    <Form.Item
                      name="newPassword"
                      label="新密码"
                      rules={[
                        { required: true, message: '请输入新密码' },
                        { min: 6, message: '至少 6 位' },
                      ]}
                    >
                      <Input.Password />
                    </Form.Item>
                    <Form.Item
                      name="confirm"
                      label="确认新密码"
                      rules={[{ required: true, message: '请再次输入新密码' }]}
                    >
                      <Input.Password />
                    </Form.Item>
                    <Button type="primary" htmlType="submit" loading={busy}>
                      更新密码
                    </Button>
                  </Form>
                  <Divider />
                  <Typography.Text type="secondary">
                    当前登录账号：{username}
                  </Typography.Text>
                </>
              ),
            },
          ]}
        />
      </Card>
    </Space>
  );
}
