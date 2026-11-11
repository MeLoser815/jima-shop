import { useEffect, useState } from 'react';
import { App, Button, Card, Space, Typography } from 'antd';
import { CheckCircleFilled } from '@ant-design/icons';
import { api, type ThemePreset } from '../../api';
import { THEMES, asThemeId, type ThemeId } from '../../themes';
import { useStoreTheme } from '../../ThemeProvider';

const SWATCH: Record<string, string> = {
  strawberry:
    'linear-gradient(135deg, #ff6b9d, #ffd1e4 45%, #b8a4ff)',
  guofeng:
    'linear-gradient(135deg, #3d5563 0%, #8fa3ad 32%, #f7f6f3 58%, #9a7b3c 82%, #b08a78 100%)',
  angel:
    'linear-gradient(135deg, #fffdf8 0%, #ffe9a8 40%, #c9a227 70%, #f3eeff 100%)',
  anime:
    'linear-gradient(135deg, #1a0a2e 0%, #ff2d6f 35%, #6c5ce7 65%, #00e5ff 100%)',
  cyber:
    'linear-gradient(135deg, #fffdf8 0%, #ffe9a8 40%, #c9a227 70%, #f3eeff 100%)',
};

export default function Appearance() {
  const { message } = App.useApp();
  const storeTheme = useStoreTheme();
  const [themeId, setThemeId] = useState<string>('strawberry');
  const [presets, setPresets] = useState<ThemePreset[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api
      .getAdminTheme()
      .then((r) => {
        setThemeId(asThemeId(r.themeId));
        setPresets(r.presets);
      })
      .catch((e) => message.error((e as Error).message));
  }, [message]);

  async function apply(id: string) {
    setSaving(true);
    try {
      await api.setAdminTheme(id);
      const nid = asThemeId(id);
      setThemeId(nid);
      storeTheme.setThemeLocal(nid as ThemeId);
      message.success('前台风格已切换');
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const list = presets.length
    ? presets
    : Object.values(THEMES).map((t) => ({
        id: t.id,
        name: t.name,
        emoji: t.emoji,
        description: t.description,
      }));

  return (
    <div>
      <Space direction="vertical" size={4} style={{ marginBottom: 16 }}>
        <Typography.Title level={3} style={{ margin: 0 }}>
          风格与模板
        </Typography.Title>
        <Typography.Text type="secondary">
          选择一套前台视觉模板，立即作用于店铺首页 / 详情 / 购物车（响应式同步）
        </Typography.Text>
      </Space>

      <div className="theme-grid">
        {list.map((p) => {
          const active = p.id === themeId;
          return (
            <Card
              key={p.id}
              className={`theme-card glass-card ${active ? 'active' : ''}`}
              onClick={() => !saving && apply(p.id)}
            >
              <div
                className="theme-swatch"
                data-emoji={p.emoji}
                style={{ background: SWATCH[p.id] || SWATCH.strawberry }}
              />
              <Space style={{ width: '100%', justifyContent: 'space-between' }}>
                <div>
                  <Typography.Title level={5} style={{ margin: 0 }}>
                    {p.emoji} {p.name}
                  </Typography.Title>
                  <Typography.Text type="secondary">{p.description}</Typography.Text>
                </div>
                {active && (
                  <CheckCircleFilled style={{ color: 'var(--primary)', fontSize: 20 }} />
                )}
              </Space>
              <Button
                block
                style={{ marginTop: 12 }}
                type={active ? 'primary' : 'default'}
                className={active ? 'candy-btn' : undefined}
                loading={saving && themeId !== p.id}
                disabled={active}
              >
                {active ? '当前使用中' : '启用此模板'}
              </Button>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
