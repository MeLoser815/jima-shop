import { useEffect, useState } from 'react';
import {
  Alert,
  App,
  Button,
  Card,
  Drawer,
  Form,
  Input,
  Layout,
  Menu,
  Spin,
  Typography,
} from 'antd';
import {
  AppstoreOutlined,
  DashboardOutlined,
  KeyOutlined,
  LockOutlined,
  LogoutOutlined,
  MenuOutlined,
  ShoppingOutlined,
  SkinOutlined,
  UnorderedListOutlined,
  UserOutlined,
  WalletOutlined,
  FileSearchOutlined,
  QrcodeOutlined,
} from '@ant-design/icons';
import {
  Link,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from 'react-router-dom';
import { api, getToken, setToken } from '../../api';
import { ADMIN_BASE_PATH, adminPath } from '../../adminPath';
import Dashboard from './Dashboard';
import Products from './Products';
import Orders from './Orders';
import Settings from './Settings';
import Account from './Account';
import Categories from './Categories';
import Appearance from './Appearance';
import Audit from './Audit';
import CashierPage from '../Cashier';

const { Sider, Content, Header } = Layout;

function menuItems() {
  return [
    {
      key: adminPath(),
      icon: <DashboardOutlined />,
      label: <Link to={adminPath()}>仪表盘</Link>,
    },
    {
      key: adminPath('products'),
      icon: <ShoppingOutlined />,
      label: <Link to={adminPath('products')}>商品管理</Link>,
    },
    {
      key: adminPath('categories'),
      icon: <AppstoreOutlined />,
      label: <Link to={adminPath('categories')}>商品分类</Link>,
    },
    {
      key: adminPath('orders'),
      icon: <UnorderedListOutlined />,
      label: <Link to={adminPath('orders')}>订单列表</Link>,
    },
    {
      key: adminPath('cashier'),
      icon: <QrcodeOutlined />,
      label: <Link to={adminPath('cashier')}>收银台</Link>,
    },
    {
      key: adminPath('audit'),
      icon: <FileSearchOutlined />,
      label: <Link to={adminPath('audit')}>操作日志</Link>,
    },
    {
      key: adminPath('appearance'),
      icon: <SkinOutlined />,
      label: <Link to={adminPath('appearance')}>风格模板</Link>,
    },
    {
      key: adminPath('settings'),
      icon: <WalletOutlined />,
      label: <Link to={adminPath('settings')}>收款配置</Link>,
    },
    {
      key: adminPath('account'),
      icon: <KeyOutlined />,
      label: <Link to={adminPath('account')}>账号安全</Link>,
    },
  ];
}

function resolveKey(pathname: string): string {
  const selected = pathname.replace(/\/$/, '') || ADMIN_BASE_PATH;
  const keys = [
    adminPath('products'),
    adminPath('categories'),
    adminPath('orders'),
    adminPath('cashier'),
    adminPath('audit'),
    adminPath('appearance'),
    adminPath('settings'),
    adminPath('account'),
  ];
  for (const k of keys) {
    if (selected === k || selected.startsWith(`${k}/`)) return k;
  }
  return ADMIN_BASE_PATH;
}

export default function AdminApp() {
  const { message } = App.useApp();
  const location = useLocation();
  const navigate = useNavigate();
  const [bootLoading, setBootLoading] = useState(true);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [authed, setAuthed] = useState(Boolean(getToken()));
  const [username, setUsername] = useState('');
  const [authForm] = Form.useForm();
  const [busy, setBusy] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    (async () => {
      setBootLoading(true);
      try {
        const res = await api.bootstrap();
        setNeedsSetup(res.needsSetup);
        if (res.needsSetup) {
          setAuthed(false);
          setToken(null);
        } else if (getToken()) {
          try {
            const me = await api.me();
            setUsername(me.username);
            setAuthed(true);
          } catch {
            setAuthed(false);
            setToken(null);
          }
        }
      } catch (e) {
        message.error((e as Error).message);
      } finally {
        setBootLoading(false);
      }
    })();
  }, [message]);

  async function onAuth() {
    const values = await authForm.validateFields();
    setBusy(true);
    try {
      const res = needsSetup
        ? await api.setup(values.username, values.password)
        : await api.login(values.username, values.password);
      setToken(res.token);
      setUsername(res.username);
      setNeedsSetup(false);
      setAuthed(true);
      message.success(needsSetup ? '管理员创建成功' : '登录成功');
      navigate(ADMIN_BASE_PATH);
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    try {
      await api.logout();
    } catch {
      /* ignore */
    }
    setToken(null);
    setAuthed(false);
    setUsername('');
    message.success('已退出');
  }

  if (bootLoading) {
    return (
      <div className="center-spin">
        <Spin size="large" tip="加载中…" />
      </div>
    );
  }

  if (!authed) {
    return (
      <div className="auth-stage">
        <Card className="auth-card glass-card" title={null}>
          <div style={{ textAlign: 'center', marginBottom: 16 }}>
            <div style={{ fontSize: 40 }}>🧁</div>
            <Typography.Title level={3} style={{ marginBottom: 4 }}>
              {needsSetup ? '首次安装' : '管理后台登录'}
            </Typography.Title>
            <Typography.Text type="secondary">
              {needsSetup
                ? '请自行设置管理员账号与密码'
                : '使用你设置的账号密码登录'}
            </Typography.Text>
          </div>
          {needsSetup && (
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 16 }}
              message="仅首次可创建管理员，请妥善保管账号密码。"
            />
          )}
          <Form form={authForm} layout="vertical" onFinish={onAuth}>
            <Form.Item
              name="username"
              label="用户名"
              rules={[{ required: true, min: 3, message: '至少 3 位' }]}
            >
              <Input
                prefix={<UserOutlined />}
                placeholder="管理员用户名"
                size="large"
              />
            </Form.Item>
            <Form.Item
              name="password"
              label="密码"
              rules={
                needsSetup
                  ? [{ required: true, min: 8, message: '至少 8 位' }]
                  : [{ required: true, message: '请输入密码' }]
              }
            >
              <Input.Password
                prefix={<LockOutlined />}
                placeholder="登录密码"
                size="large"
              />
            </Form.Item>
            <Button
              type="primary"
              htmlType="submit"
              block
              size="large"
              className="candy-btn"
              loading={busy}
            >
              {needsSetup ? '创建并进入' : '登录'}
            </Button>
          </Form>
          <div style={{ marginTop: 16, textAlign: 'center' }}>
            <Link to="/">← 返回小店</Link>
          </div>
        </Card>
      </div>
    );
  }

  const key = resolveKey(location.pathname);
  const items = menuItems();

  return (
    <Layout className="admin-shell">
      <div className="admin-mobile-bar">
        <Button
          type="text"
          icon={<MenuOutlined />}
          onClick={() => setDrawerOpen(true)}
        />
        <Typography.Text strong>即码小店后台</Typography.Text>
        <Button type="link" onClick={() => navigate('/')}>
          前台
        </Button>
      </div>
      <Drawer
        title="后台菜单"
        placement="left"
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        styles={{ body: { padding: 0 } }}
      >
        <Menu
          mode="inline"
          selectedKeys={[key]}
          items={items}
          onClick={() => setDrawerOpen(false)}
          style={{ borderInlineEnd: 0 }}
        />
        <div style={{ padding: 16 }}>
          <Typography.Text type="secondary">{username}</Typography.Text>
          <Button block icon={<LogoutOutlined />} onClick={logout} style={{ marginTop: 8 }}>
            退出
          </Button>
        </div>
      </Drawer>
      <Sider
        breakpoint="lg"
        collapsedWidth={0}
        trigger={null}
        className="admin-sider"
        width={220}
      >
        <div className="admin-brand">
          <span>🧁</span>
          <div>
            <div className="brand-title">即码小店</div>
            <div className="brand-sub">Admin</div>
          </div>
        </div>
        <Menu theme="light" mode="inline" selectedKeys={[key]} items={items} />
      </Sider>
      <Layout>
        <Header className="admin-header">
          <Typography.Text>
            你好，<b>{username}</b>
          </Typography.Text>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <Link to="/">店铺前台</Link>
            <Button type="text" icon={<LogoutOutlined />} onClick={logout}>
              退出
            </Button>
          </div>
        </Header>
        <Content className="admin-content">
          <Routes>
            <Route index element={<Dashboard />} />
            <Route path="products" element={<Products />} />
            <Route path="categories" element={<Categories />} />
            <Route path="orders" element={<Orders />} />
            <Route path="cashier" element={<CashierPage />} />
            <Route path="audit" element={<Audit />} />
            <Route path="appearance" element={<Appearance />} />
            <Route path="settings" element={<Settings />} />
            <Route path="account" element={<Account />} />
            <Route path="*" element={<Navigate to={ADMIN_BASE_PATH} replace />} />
          </Routes>
        </Content>
      </Layout>
    </Layout>
  );
}
