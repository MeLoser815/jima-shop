import { Button, Card, Col, Empty, Row, Tag, Typography } from 'antd';
import {
  FireFilled,
  HeartFilled,
  ShoppingCartOutlined,
  ThunderboltFilled,
  StarFilled,
} from '@ant-design/icons';
import { Link } from 'react-router-dom';
import type { HomeLayoutProps } from './types';

/** Cute rounded grid — soft hero + featured rail + card grid */
export default function StrawberryHome({
  theme,
  products,
  categories,
  categoryId,
  setCategoryId,
  loading,
  featured,
  onAdd,
}: HomeLayoutProps) {
  return (
    <div className="store-home layout-strawberry">
      <section className="hero-banner floaty">
        <div className="hero-glow" />
        <div className="hero-sparkles" aria-hidden />
        <div className="hero-copy">
          <Tag className="pill-tag hero-tag">
            <StarFilled /> {theme.heroTag}
          </Tag>
          <Typography.Title level={1} className="hero-kawaii-title">
            {theme.heroTitle}
          </Typography.Title>
          <Typography.Paragraph className="hero-desc">
            {theme.heroDesc}
          </Typography.Paragraph>
          <div className="hero-actions">
            <Button type="primary" size="large" className="candy-btn" href="#goods">
              开始选购
            </Button>
            <Button size="large" className="candy-btn-ghost" href="#featured">
              今日精选
            </Button>
          </div>
          <div className="hero-stats">
            <div className="hero-stat">
              <b>{products.length || '—'}</b>
              <span>在售好物</span>
            </div>
            <div className="hero-stat">
              <b>{categories.length || '—'}</b>
              <span>精选分类</span>
            </div>
            <div className="hero-stat">
              <b>当面付</b>
              <span>秒速出码</span>
            </div>
          </div>
        </div>
        <div className="hero-stage" aria-hidden>
          <div className="hero-mascot">{theme.emoji}</div>
          <div className="hero-ring" />
        </div>
      </section>

      {featured.length > 0 && (
        <section id="featured" className="featured-strip floaty">
          <div className="section-head tight">
            <Typography.Title level={4} style={{ margin: 0 }}>
              <FireFilled style={{ color: 'var(--primary)', marginRight: 8 }} />
              今日精选
            </Typography.Title>
            <Typography.Text type="secondary">手慢无 · 先到先得</Typography.Text>
          </div>
          <div className="featured-rail">
            {featured.map((p, i) => (
              <Link to={`/p/${p.id}`} key={p.id} className={`featured-card f-${i}`}>
                <div
                  className="featured-cover"
                  style={{
                    backgroundImage: p.coverUrl ? `url(${p.coverUrl})` : undefined,
                  }}
                >
                  {!p.coverUrl && <span className="cover-emoji">🎁</span>}
                  <span className="featured-rank">TOP {i + 1}</span>
                </div>
                <div className="featured-meta">
                  <div className="product-name">{p.name}</div>
                  <div className="price">¥{p.price}</div>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      <div className="category-rail" role="tablist" aria-label="商品分类">
        <Button
          className={`cat-chip ${categoryId === 'all' ? 'active' : ''}`}
          onClick={() => setCategoryId('all')}
        >
          <ThunderboltFilled /> 全部
        </Button>
        {categories.map((c) => (
          <Button
            key={c.id}
            className={`cat-chip ${categoryId === c.id ? 'active' : ''}`}
            onClick={() => setCategoryId(c.id)}
          >
            {c.icon} {c.name}
          </Button>
        ))}
      </div>

      <div id="goods" className="section-head">
        <Typography.Title level={3} style={{ margin: 0 }}>
          <HeartFilled style={{ color: 'var(--primary)', marginRight: 8 }} />
          {categoryId === 'all'
            ? '全部好物'
            : categories.find((c) => c.id === categoryId)?.name || '精选'}
        </Typography.Title>
        <Typography.Text type="secondary">
          {loading ? '加载中…' : `共 ${products.length} 件`}
        </Typography.Text>
      </div>

      {!products.length && !loading ? (
        <Empty description="这个分类暂时没有商品哦～" />
      ) : (
        <Row gutter={[18, 18]} className="product-grid">
          {products.map((p, idx) => (
            <Col
              xs={12}
              sm={12}
              md={8}
              lg={idx === 0 && categoryId === 'all' ? 12 : 6}
              key={p.id}
            >
              <Card
                hoverable
                className={`product-card ${idx === 0 && categoryId === 'all' ? 'product-card-hero' : ''}`}
                cover={
                  <Link to={`/p/${p.id}`} className="product-cover-link">
                    <div
                      className="product-cover"
                      style={{
                        backgroundImage: p.coverUrl
                          ? `url(${p.coverUrl})`
                          : undefined,
                      }}
                    >
                      {!p.coverUrl && <span className="cover-emoji">🎁</span>}
                      {p.stock <= 5 && p.stock > 0 && (
                        <span className="ribbon">即将售罄</span>
                      )}
                      {p.stock <= 0 && <div className="sold-out">售罄</div>}
                    </div>
                  </Link>
                }
                actions={[
                  <Link key="view" to={`/p/${p.id}`}>
                    详情
                  </Link>,
                  <Button
                    key="cart"
                    type="link"
                    icon={<ShoppingCartOutlined />}
                    disabled={p.stock <= 0}
                    onClick={() => onAdd(p)}
                  >
                    加购
                  </Button>,
                ]}
              >
                <Card.Meta
                  title={
                    <Link to={`/p/${p.id}`} className="product-name">
                      {p.name}
                    </Link>
                  }
                  description={
                    <div className="product-meta">
                      <span className="price">¥{p.price}</span>
                      <span className="stock">剩余 {p.stock} 张</span>
                    </div>
                  }
                />
              </Card>
            </Col>
          ))}
        </Row>
      )}
    </div>
  );
}
