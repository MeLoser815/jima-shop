import { useEffect, useState } from 'react';
import {
  App,
  Button,
  Card,
  Col,
  InputNumber,
  Row,
  Space,
  Spin,
  Tag,
  Typography,
} from 'antd';
import {
  ArrowLeftOutlined,
  ShoppingCartOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, type Product } from '../../api';
import { useCart } from '../../cart';
import { useStoreTheme } from '../../ThemeProvider';

export default function ProductDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { message } = App.useApp();
  const cart = useCart();
  const { theme } = useStoreTheme();
  const [product, setProduct] = useState<Product | null>(null);
  const [qty, setQty] = useState(1);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const pid = Number(id);
    if (!Number.isFinite(pid)) {
      setLoading(false);
      return;
    }
    api
      .getProduct(pid)
      .then((r) => setProduct(r.product))
      .catch((e) => message.error((e as Error).message))
      .finally(() => setLoading(false));
  }, [id, message]);

  if (loading) {
    return (
      <div className="center-spin">
        <Spin size="large" />
      </div>
    );
  }
  if (!product) {
    return (
      <Card className="glass-card">
        <Typography.Text>商品不存在</Typography.Text>
        <div style={{ marginTop: 12 }}>
          <Link to="/">返回首页</Link>
        </div>
      </Card>
    );
  }

  function addCart(goCart = false) {
    cart.add({
      productId: product!.id,
      name: product!.name,
      price: product!.price,
      coverUrl: product!.coverUrl,
      stock: product!.stock,
      quantity: qty,
    });
    message.success('已加入购物车 ♡');
    if (goCart) nav('/cart');
  }

  return (
    <div className="detail-page">
      <Button
        type="link"
        icon={<ArrowLeftOutlined />}
        onClick={() => nav(-1)}
        className="back-link"
      >
        返回
      </Button>
      <Card className="glass-card detail-card">
        <Row gutter={[32, 28]} align="middle">
          <Col xs={24} md={11}>
            <div className="detail-cover-wrap">
              <div
                className="detail-cover"
                style={{
                  backgroundImage: product.coverUrl
                    ? `url(${product.coverUrl})`
                    : undefined,
                }}
              >
                {!product.coverUrl && <span className="cover-emoji">🎁</span>}
              </div>
              <div className="detail-cover-glow" aria-hidden />
            </div>
          </Col>
          <Col xs={24} md={13}>
            <Space direction="vertical" size={16} style={{ width: '100%' }}>
              <div>
                <Tag className="pill-tag hero-tag">{theme.emoji} {theme.name}</Tag>
                <Typography.Title level={2} className="detail-title">
                  {product.name}
                </Typography.Title>
                <Typography.Paragraph className="detail-desc">
                  {product.description || '暂无描述'}
                </Typography.Paragraph>
              </div>
              <div className="detail-price-panel">
                <div className="detail-price-row">
                  <span className="price big">¥{product.price}</span>
                  <span className="stock">剩余 {product.stock} 张</span>
                </div>
                <Space align="center" wrap>
                  <span className="qty-label">数量</span>
                  <InputNumber
                    min={1}
                    max={Math.max(1, product.stock)}
                    value={qty}
                    onChange={(v) => setQty(Number(v) || 1)}
                    disabled={product.stock <= 0}
                    size="large"
                  />
                </Space>
              </div>
              <div className="detail-actions desktop-only">
                <Button
                  type="primary"
                  size="large"
                  className="candy-btn"
                  icon={<ShoppingCartOutlined />}
                  disabled={product.stock <= 0}
                  onClick={() => addCart(false)}
                >
                  加入购物车
                </Button>
                <Button
                  size="large"
                  className="candy-btn-ghost"
                  icon={<ThunderboltOutlined />}
                  disabled={product.stock <= 0}
                  onClick={() => addCart(true)}
                >
                  立即购买
                </Button>
              </div>
            </Space>
          </Col>
        </Row>
      </Card>

      <div className="mobile-buy-bar">
        <div className="price big">¥{product.price}</div>
        <Space>
          <Button
            className="candy-btn-ghost"
            icon={<ShoppingCartOutlined />}
            disabled={product.stock <= 0}
            onClick={() => addCart(false)}
          >
            加购
          </Button>
          <Button
            type="primary"
            className="candy-btn"
            disabled={product.stock <= 0}
            onClick={() => addCart(true)}
          >
            立即买
          </Button>
        </Space>
      </div>
    </div>
  );
}
