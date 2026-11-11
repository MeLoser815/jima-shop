import { App, Button, Card, Empty, InputNumber, Space, Typography } from 'antd';
import { DeleteOutlined, PayCircleOutlined, ShoppingOutlined } from '@ant-design/icons';
import { Link, useNavigate } from 'react-router-dom';
import { useCart } from '../../cart';
import { useStoreTheme } from '../../ThemeProvider';

export default function CartPage() {
  const cart = useCart();
  const nav = useNavigate();
  const { message } = App.useApp();
  const { theme } = useStoreTheme();

  if (!cart.items.length) {
    return (
      <Card className="glass-card cart-empty">
        <Empty
          image={<span style={{ fontSize: 56 }}>{theme.emoji}</span>}
          description="购物车还是空的哦～"
        >
          <Link to="/">
            <Button type="primary" className="candy-btn" icon={<ShoppingOutlined />}>
              去逛逛
            </Button>
          </Link>
        </Empty>
      </Card>
    );
  }

  return (
    <div className="cart-page">
      <div className="section-head">
        <Typography.Title level={3} style={{ margin: 0 }}>
          🛒 购物车
        </Typography.Title>
        <Typography.Text type="secondary">{theme.name} · {cart.count} 件</Typography.Text>
      </div>
      <Space direction="vertical" size={14} style={{ width: '100%' }}>
        {cart.items.map((it) => (
          <Card key={it.productId} className="glass-card cart-line" size="small">
            <div className="cart-line-inner">
              <div
                className="cart-thumb"
                style={{
                  backgroundImage: it.coverUrl
                    ? `url(${it.coverUrl})`
                    : undefined,
                }}
              />
              <div className="cart-info">
                <Link to={`/p/${it.productId}`} className="product-name">
                  {it.name}
                </Link>
                <div className="price">¥{it.price}</div>
              </div>
              <InputNumber
                min={1}
                max={it.stock}
                value={it.quantity}
                onChange={(v) => cart.setQty(it.productId, Number(v) || 1)}
              />
              <div className="cart-line-total">
                ¥{(Number(it.price) * it.quantity).toFixed(2)}
              </div>
              <Button
                type="text"
                danger
                icon={<DeleteOutlined />}
                onClick={() => cart.remove(it.productId)}
              />
            </div>
          </Card>
        ))}
      </Space>

      <Card className="glass-card cart-summary">
        <div className="cart-summary-row">
          <div className="cart-summary-meta">
            共 <b>{cart.count}</b> 件
          </div>
          <div className="cart-summary-total">
            合计{' '}
            <span className="price big">¥{cart.total.toFixed(2)}</span>
          </div>
          <Button
            type="primary"
            size="large"
            className="candy-btn"
            icon={<PayCircleOutlined />}
            onClick={() => {
              if (cart.total < 0.01) {
                message.warning('金额太低');
                return;
              }
              nav('/pay');
            }}
          >
            去结算
          </Button>
        </div>
      </Card>
    </div>
  );
}
