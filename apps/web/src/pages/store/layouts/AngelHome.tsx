import { Button, Empty, Typography } from 'antd';
import { ShoppingCartOutlined } from '@ant-design/icons';
import { Link } from 'react-router-dom';
import type { HomeLayoutProps } from './types';

/**
 * 神圣天使：居中圣所英雄（无右侧吉祥物）+ 圆环分类 + 杂志级左右交错大卡
 */
export default function AngelHome({
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
    <div className="store-home layout-angel">
      <section className="angel-sanctum floaty">
        <div className="angel-wing left" aria-hidden />
        <div className="angel-wing right" aria-hidden />
        <div className="angel-halo-ring" aria-hidden />
        <p className="angel-kicker">{theme.heroTag}</p>
        <Typography.Title level={1} className="angel-title">
          {theme.heroTitle}
        </Typography.Title>
        <Typography.Paragraph className="angel-desc">
          {theme.heroDesc}
        </Typography.Paragraph>
        <div className="angel-cta">
          <Button type="primary" size="large" className="candy-btn" href="#angel-goods">
            沐光选购
          </Button>
        </div>
        <div className="angel-metrics">
          <div>
            <strong>{products.length || '—'}</strong>
            <span>圣品</span>
          </div>
          <div>
            <strong>{categories.length || '—'}</strong>
            <span>殿堂</span>
          </div>
          <div>
            <strong>当面付</strong>
            <span>降临</span>
          </div>
        </div>
      </section>

      {featured.length > 0 && (
        <section className="angel-blessed floaty">
          <Typography.Title level={4} className="angel-section-title">
            光耀精选
          </Typography.Title>
          <div className="angel-blessed-row">
            {featured.map((p) => (
              <Link key={p.id} to={`/p/${p.id}`} className="angel-blessed-card">
                <div
                  className="angel-blessed-cover"
                  style={{
                    backgroundImage: p.coverUrl ? `url(${p.coverUrl})` : undefined,
                  }}
                >
                  {!p.coverUrl && <span className="cover-emoji">👼</span>}
                </div>
                <div>
                  <div className="product-name">{p.name}</div>
                  <div className="price">¥{p.price}</div>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      <div className="angel-orbs" role="tablist" aria-label="分类">
        <button
          type="button"
          className={`angel-orb ${categoryId === 'all' ? 'active' : ''}`}
          onClick={() => setCategoryId('all')}
        >
          全部
        </button>
        {categories.map((c) => (
          <button
            type="button"
            key={c.id}
            className={`angel-orb ${categoryId === c.id ? 'active' : ''}`}
            onClick={() => setCategoryId(c.id)}
          >
            <span>{c.icon}</span>
            {c.name}
          </button>
        ))}
      </div>

      <div id="angel-goods" className="angel-goods-head">
        <Typography.Title level={3} style={{ margin: 0, textAlign: 'center' }}>
          {categoryId === 'all'
            ? '圣所陈列'
            : categories.find((c) => c.id === categoryId)?.name || '精选'}
        </Typography.Title>
        <Typography.Text
          type="secondary"
          style={{ display: 'block', textAlign: 'center', marginTop: 6 }}
        >
          {loading ? '凝聚光尘…' : `${products.length} 件纯净好物`}
        </Typography.Text>
      </div>

      {!products.length && !loading ? (
        <Empty description="此殿暂无陈列" />
      ) : (
        <div className="angel-cascade">
          {products.map((p, i) => (
            <article
              key={p.id}
              className={`angel-slab ${i % 2 === 1 ? 'flip' : ''}`}
            >
              <Link to={`/p/${p.id}`} className="angel-slab-media">
                <div
                  className="angel-slab-cover"
                  style={{
                    backgroundImage: p.coverUrl ? `url(${p.coverUrl})` : undefined,
                  }}
                >
                  {!p.coverUrl && <span className="cover-emoji">✨</span>}
                  {p.stock <= 0 && <div className="sold-out">售罄</div>}
                </div>
              </Link>
              <div className="angel-slab-copy">
                <Typography.Title level={4}>
                  <Link to={`/p/${p.id}`} className="product-name">
                    {p.name}
                  </Link>
                </Typography.Title>
                <p className="angel-slab-desc">
                  {p.description || '沐光而生的温柔好物'}
                </p>
                <div className="angel-slab-foot">
                  <span className="price big">¥{p.price}</span>
                  <Button
                    type="primary"
                    className="candy-btn"
                    icon={<ShoppingCartOutlined />}
                    disabled={p.stock <= 0}
                    onClick={() => onAdd(p)}
                  >
                    加购
                  </Button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
