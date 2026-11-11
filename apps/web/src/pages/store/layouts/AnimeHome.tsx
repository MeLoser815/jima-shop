import { Button, Empty, Typography } from 'antd';
import { ShoppingCartOutlined } from '@ant-design/icons';
import { Link } from 'react-router-dom';
import type { HomeLayoutProps } from './types';

/**
 * 次元集市：漫画 splash 英雄 + 倾斜贴纸分类 + 不规则分镜商品格
 */
export default function AnimeHome({
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
    <div className="store-home layout-anime">
      <section className="anime-splash floaty">
        <div className="anime-speedlines" aria-hidden />
        <div className="anime-bubble">
          <span className="anime-bubble-tag">{theme.heroTag}</span>
          <Typography.Title level={1} className="anime-splash-title">
            {theme.heroTitle}
          </Typography.Title>
          <Typography.Paragraph className="anime-splash-desc">
            {theme.heroDesc}
          </Typography.Paragraph>
          <div className="anime-splash-actions">
            <Button type="primary" size="large" className="candy-btn" href="#anime-panels">
              GO! 选购
            </Button>
            <Button size="large" className="candy-btn-ghost" href="#anime-next">
              NEXT EP
            </Button>
          </div>
        </div>
        <div className="anime-sfx" aria-hidden>
          <span>ドン</span>
          <span>キラッ</span>
        </div>
        <div className="anime-mascot-pop" aria-hidden>
          {theme.emoji}
        </div>
      </section>

      {featured.length > 0 && (
        <section id="anime-next" className="anime-next-ep floaty">
          <div className="anime-next-label">NEXT EPISODE</div>
          <div className="anime-next-rail">
            {featured.map((p, i) => (
              <Link key={p.id} to={`/p/${p.id}`} className={`anime-next-card ep-${i}`}>
                <div
                  className="anime-next-cover"
                  style={{
                    backgroundImage: p.coverUrl ? `url(${p.coverUrl})` : undefined,
                  }}
                >
                  {!p.coverUrl && <span className="cover-emoji">⭐</span>}
                  <span className="anime-ep-badge">EP.{i + 1}</span>
                </div>
                <div className="anime-next-meta">
                  <div className="product-name">{p.name}</div>
                  <div className="price">¥{p.price}</div>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      <div className="anime-stickers" role="tablist" aria-label="分类贴纸">
        <button
          type="button"
          className={`anime-sticker s0 ${categoryId === 'all' ? 'active' : ''}`}
          onClick={() => setCategoryId('all')}
        >
          ALL★
        </button>
        {categories.map((c, i) => (
          <button
            type="button"
            key={c.id}
            className={`anime-sticker s${(i % 5) + 1} ${categoryId === c.id ? 'active' : ''}`}
            onClick={() => setCategoryId(c.id)}
          >
            {c.icon} {c.name}
          </button>
        ))}
      </div>

      <div id="anime-panels" className="anime-panels-head">
        <Typography.Title level={3} style={{ margin: 0 }}>
          {categoryId === 'all'
            ? '分镜货架'
            : categories.find((c) => c.id === categoryId)?.name || '精选'}
        </Typography.Title>
        <Typography.Text type="secondary">
          {loading ? '分镜绘制中…' : `${products.length} CUTS`}
        </Typography.Text>
      </div>

      {!products.length && !loading ? (
        <Empty description="这一话还没有登场角色哦" />
      ) : (
        <div className="anime-panel-grid">
          {products.map((p, idx) => {
            const span =
              idx % 7 === 0 ? 'wide' : idx % 5 === 0 ? 'tall' : idx % 3 === 0 ? 'skew' : 'std';
            return (
              <article key={p.id} className={`anime-panel ${span}`}>
                <Link to={`/p/${p.id}`} className="anime-panel-link">
                  <div
                    className="anime-panel-cover"
                    style={{
                      backgroundImage: p.coverUrl ? `url(${p.coverUrl})` : undefined,
                    }}
                  >
                    {!p.coverUrl && <span className="cover-emoji">💥</span>}
                    {p.stock <= 5 && p.stock > 0 && (
                      <span className="ribbon">HOT</span>
                    )}
                    {p.stock <= 0 && <div className="sold-out">SOLD</div>}
                    <div className="anime-panel-caption">
                      <span className="product-name">{p.name}</span>
                      <span className="price">¥{p.price}</span>
                    </div>
                  </div>
                </Link>
                <Button
                  block
                  type="primary"
                  className="candy-btn anime-panel-buy"
                  icon={<ShoppingCartOutlined />}
                  disabled={p.stock <= 0}
                  onClick={() => onAdd(p)}
                >
                  加购!
                </Button>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
