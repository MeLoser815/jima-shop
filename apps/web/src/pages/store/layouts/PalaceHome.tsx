import { Button, Empty, Typography } from 'antd';
import { ShoppingCartOutlined } from '@ant-design/icons';
import { Link } from 'react-router-dom';
import type { HomeLayoutProps } from './types';

/**
 * 天宫仙阙 · 电影级写实仙侠
 * 全幅大气层英雄区 + 竖向分类脊线 + 奢侈编辑式商品排版
 * 与草莓网格 / 天使杂志流 / 动漫分镜结构完全不同
 */
export default function PalaceHome({
  theme,
  products,
  categories,
  categoryId,
  setCategoryId,
  loading,
  featured,
  onAdd,
}: HomeLayoutProps) {
  const lead = featured[0] ?? products[0];
  const rest = products.filter((p) => !lead || p.id !== lead.id);
  const catalog = rest.length ? rest : products.slice(lead ? 1 : 0);
  const catLabel =
    categoryId === 'all'
      ? '全部藏品'
      : categories.find((c) => c.id === categoryId)?.name || '精选';

  return (
    <div className="store-home layout-palace">
      <section className="palace-cinema" aria-label="天宫仙阙">
        <div className="palace-cinema-sky" aria-hidden>
          <span className="palace-haze h1" />
          <span className="palace-haze h2" />
          <span className="palace-haze h3" />
          <span className="palace-dawn" />
          <span className="palace-horizon" />
          <span className="palace-distant" />
        </div>

        <div className="palace-cinema-copy">
          <p className="palace-kicker">
            <span className="palace-hairline" />
            {theme.heroTag}
            <span className="palace-hairline" />
          </p>
          <Typography.Title level={1} className="palace-title">
            {theme.heroTitle}
          </Typography.Title>
          <Typography.Paragraph className="palace-desc">
            {theme.heroDesc}
          </Typography.Paragraph>
          <div className="palace-actions">
            <Button type="primary" size="large" className="candy-btn" href="#palace-collection">
              进入藏馆
            </Button>
            <Button size="large" className="candy-btn-ghost" href="#palace-feature">
              本季荐品
            </Button>
          </div>
        </div>
      </section>

      <div className="palace-body">
        <aside className="palace-spine" aria-label="分类">
          <button
            type="button"
            className={`palace-spine-item ${categoryId === 'all' ? 'active' : ''}`}
            onClick={() => setCategoryId('all')}
          >
            <span className="palace-spine-mark" />
            <span className="palace-spine-text">全部</span>
          </button>
          {categories.map((c) => (
            <button
              type="button"
              key={c.id}
              className={`palace-spine-item ${categoryId === c.id ? 'active' : ''}`}
              onClick={() => setCategoryId(c.id)}
            >
              <span className="palace-spine-mark" />
              <span className="palace-spine-text">{c.name}</span>
            </button>
          ))}
        </aside>

        <div className="palace-main">
          {lead && (
            <section id="palace-feature" className="palace-editorial">
              <Link to={`/p/${lead.id}`} className="palace-editorial-media">
                <div
                  className="palace-editorial-cover"
                  style={{
                    backgroundImage: lead.coverUrl
                      ? `url(${lead.coverUrl})`
                      : undefined,
                  }}
                >
                  {!lead.coverUrl && <span className="cover-emoji">🏯</span>}
                </div>
              </Link>
              <div className="palace-editorial-copy">
                <p className="palace-editorial-label">本季荐品</p>
                <Typography.Title level={2} className="palace-editorial-title">
                  {lead.name}
                </Typography.Title>
                <Typography.Paragraph className="palace-editorial-desc">
                  {lead.description || '云上精选 · 支付宝即纳'}
                </Typography.Paragraph>
                <div className="palace-editorial-foot">
                  <span className="price">¥{lead.price}</span>
                  <span className="palace-stock">剩余 {lead.stock} 张</span>
                  <Button
                    type="primary"
                    className="candy-btn"
                    icon={<ShoppingCartOutlined />}
                    disabled={lead.stock <= 0}
                    onClick={() => onAdd(lead)}
                  >
                    收入匣中
                  </Button>
                </div>
              </div>
            </section>
          )}

          <div id="palace-collection" className="palace-collection-head">
            <div>
              <Typography.Title level={4} className="palace-collection-title">
                {catLabel}
              </Typography.Title>
              <Typography.Text className="palace-collection-sub">
                {loading ? '云雾将散…' : `${products.length} 件 · 静候检阅`}
              </Typography.Text>
            </div>
            <span className="palace-collection-rule" aria-hidden />
          </div>

          {!products.length && !loading ? (
            <Empty description="此间暂无藏品" />
          ) : (
            <div className="palace-lookbook">
              {catalog.map((p, idx) => (
                <article
                  key={p.id}
                  className={`palace-look-card ${idx % 2 === 1 ? 'offset' : ''}`}
                >
                  <Link to={`/p/${p.id}`} className="palace-look-media">
                    <div
                      className="palace-look-cover"
                      style={{
                        backgroundImage: p.coverUrl
                          ? `url(${p.coverUrl})`
                          : undefined,
                      }}
                    >
                      {!p.coverUrl && <span className="cover-emoji">🎁</span>}
                      {p.stock <= 0 && <div className="sold-out">告罄</div>}
                    </div>
                  </Link>
                  <div className="palace-look-body">
                    <Link to={`/p/${p.id}`} className="palace-look-name">
                      {p.name}
                    </Link>
                    {p.description ? (
                      <p className="palace-look-blurb">{p.description}</p>
                    ) : null}
                    <div className="palace-look-meta">
                      <span className="price">¥{p.price}</span>
                      <Button
                        type="text"
                        size="small"
                        className="palace-look-add"
                        icon={<ShoppingCartOutlined />}
                        disabled={p.stock <= 0}
                        onClick={() => onAdd(p)}
                      >
                        纳匣
                      </Button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
