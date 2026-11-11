import type { ReactNode } from 'react';
import { Badge, Layout, Typography } from 'antd';
import {
  ShoppingCartOutlined,
  ShopOutlined,
  HomeOutlined,
  FileSearchOutlined,
} from '@ant-design/icons';
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useCart } from './cart';
import { useStoreTheme } from './ThemeProvider';
import ThemeMotifs from './components/ThemeMotifs';
import StoreHome from './pages/store/Home';
import ProductDetail from './pages/store/ProductDetail';
import CartPage from './pages/store/Cart';
import PayPage from './pages/store/Pay';
import OrderQuery from './pages/store/OrderQuery';
import AdminApp from './pages/admin/AdminApp';
import { ADMIN_BASE_PATH, isAdminPath } from './adminPath';

const { Header, Content, Footer } = Layout;

function StoreShell({ children }: { children: ReactNode }) {
  const cart = useCart();
  const location = useLocation();
  const { theme } = useStoreTheme();
  const hideChrome = isAdminPath(location.pathname);
  if (hideChrome) return <>{children}</>;

  const path = location.pathname;
  const homeActive = path === '/';
  const cartActive = path.startsWith('/cart') || path.startsWith('/pay');
  const queryActive = path.startsWith('/order') || path.startsWith('/query');
  const shellClass = `app-shell shell-${theme.id}`;

  const navLinks = (
    <>
      <Link to="/" className={homeActive ? 'active' : ''}>
        <ShopOutlined /> {theme.id === 'guofeng' ? '仙阙' : theme.id === 'angel' ? '圣所' : theme.id === 'anime' ? 'HOME' : '首页'}
      </Link>
      <Link to="/cart" className={`cart-link ${cartActive ? 'active' : ''}`}>
        <Badge count={cart.count} size="small" color="var(--primary)">
          <ShoppingCartOutlined style={{ fontSize: 18 }} />
        </Badge>
        <span>
          {theme.id === 'guofeng'
            ? '宝匣'
            : theme.id === 'angel'
              ? '圣囊'
              : theme.id === 'anime'
                ? 'CART'
                : '购物车'}
        </span>
      </Link>
      <Link to="/order" className={queryActive ? 'active' : ''}>
        <FileSearchOutlined />{' '}
        {theme.id === 'anime' ? 'QUERY' : '查单'}
      </Link>
    </>
  );

  return (
    <Layout className={shellClass} style={{ background: 'transparent' }}>
      <ThemeMotifs themeId={theme.id} />
      <Header className={`store-header header-${theme.id}`}>
        {theme.id === 'guofeng' ? (
          <Link to="/" className="brand-link brand-palace">
            <span className="palace-brand-plaque">
              <span className="palace-brand-mark" />
              <span className="palace-brand-text">天宫仙阙</span>
            </span>
          </Link>
        ) : theme.id === 'angel' ? (
          <Link to="/" className="brand-link brand-angel">
            <span className="angel-brand-mark">{theme.emoji}</span>
            <div className="brand-text">
              <Typography.Title level={4} style={{ margin: 0 }}>
                Sanctum
              </Typography.Title>
              <span className="brand-chip">{theme.name}</span>
            </div>
          </Link>
        ) : theme.id === 'anime' ? (
          <Link to="/" className="brand-link brand-anime">
            <span className="anime-brand-badge">
              {theme.emoji} 即码BAZAAR
            </span>
          </Link>
        ) : (
          <Link to="/" className="brand-link">
            <span className="brand-emoji">{theme.emoji}</span>
            <div className="brand-text">
              <Typography.Title level={4} style={{ margin: 0 }}>
                即码小店
              </Typography.Title>
              <span className="brand-chip">{theme.name}</span>
            </div>
          </Link>
        )}
        <nav className={`store-nav nav-${theme.id}`}>{navLinks}</nav>
      </Header>
      <Content>
        <div className={`app-content content-${theme.id}`}>{children}</div>
      </Content>
      <Footer className={`page-footer footer-${theme.id}`} style={{ background: 'transparent' }}>
        即码小店 · {theme.name} · 支付宝当面付
      </Footer>
      <nav className={`mobile-bottom-nav mobile-nav-${theme.id}`} aria-label="底部导航">
        <Link to="/" className={homeActive ? 'active' : ''}>
          <span className="nav-ico">
            <HomeOutlined />
          </span>
          {theme.id === 'guofeng' ? '仙阙' : theme.id === 'angel' ? '圣所' : '首页'}
        </Link>
        <Link to="/cart" className={cartActive ? 'active' : ''}>
          <span className="nav-ico">
            <Badge count={cart.count} size="small" offset={[4, -2]} color="var(--primary)">
              <ShoppingCartOutlined />
            </Badge>
          </span>
          {theme.id === 'guofeng' ? '宝匣' : '购物车'}
        </Link>
        <Link to="/order" className={queryActive ? 'active' : ''}>
          <span className="nav-ico">
            <FileSearchOutlined />
          </span>
          查单
        </Link>
      </nav>
    </Layout>
  );
}

export default function App() {
  return (
    <StoreShell>
      <Routes>
        <Route path="/" element={<StoreHome />} />
        <Route path="/p/:id" element={<ProductDetail />} />
        <Route path="/cart" element={<CartPage />} />
        <Route path="/pay" element={<PayPage />} />
        <Route path="/order" element={<OrderQuery />} />
        <Route path="/query" element={<OrderQuery />} />
        <Route path="/cashier" element={<Navigate to="/" replace />} />
        <Route path={`${ADMIN_BASE_PATH}/*`} element={<AdminApp />} />
      </Routes>
    </StoreShell>
  );
}
