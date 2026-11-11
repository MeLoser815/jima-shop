import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { ConfigProvider, theme as antTheme } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { api } from './api';
import {
  applyThemeToDocument,
  asThemeId,
  THEMES,
  type ThemeId,
  type ThemeTokens,
} from './themes';

type ThemeCtx = {
  themeId: ThemeId;
  theme: ThemeTokens;
  loading: boolean;
  refresh: () => Promise<void>;
  setThemeLocal: (id: ThemeId) => void;
};

const Ctx = createContext<ThemeCtx | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [themeId, setThemeId] = useState<ThemeId>('strawberry');
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await api.getStoreTheme();
      setThemeId(asThemeId(res.themeId));
    } catch {
      /* keep default */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const theme = THEMES[themeId];

  useEffect(() => {
    applyThemeToDocument(theme);
  }, [theme]);

  const setThemeLocal = useCallback((id: ThemeId) => {
    setThemeId(asThemeId(id));
  }, []);

  const value = useMemo(
    () => ({ themeId, theme, loading, refresh, setThemeLocal }),
    [themeId, theme, loading, refresh, setThemeLocal],
  );

  const fontFamily =
    theme.id === 'guofeng'
      ? '"Songti SC", "Noto Serif SC", "STSong", "PingFang SC", serif'
      : theme.id === 'angel'
        ? '"PingFang SC", "Noto Sans SC", "Segoe UI", Georgia, serif'
        : theme.id === 'anime'
          ? '"PingFang SC", "Noto Sans SC", "Segoe UI", system-ui, sans-serif'
          : '"PingFang SC", "Noto Sans SC", "Segoe UI", system-ui, -apple-system, sans-serif';

  return (
    <Ctx.Provider value={value}>
      <ConfigProvider
        locale={zhCN}
        theme={{
          algorithm: theme.dark
            ? antTheme.darkAlgorithm
            : antTheme.defaultAlgorithm,
          token: {
            colorPrimary: theme.antdPrimary,
            colorInfo: theme.secondary,
            colorSuccess: theme.id === 'angel' ? '#c9a227' : '#5ad1a3',
            borderRadius: theme.borderRadius ?? 14,
            fontFamily,
          },
          components: {
            Button: {
              borderRadius:
                theme.id === 'anime'
                  ? 12
                  : theme.id === 'guofeng'
                    ? 6
                    : theme.id === 'angel'
                      ? 999
                      : 999,
            },
            Card: {
              borderRadiusLG:
                theme.id === 'anime'
                  ? 16
                  : theme.id === 'guofeng'
                    ? 10
                    : theme.id === 'angel'
                      ? 24
                      : 22,
            },
          },
        }}
      >
        {children}
      </ConfigProvider>
    </Ctx.Provider>
  );
}

export function useStoreTheme() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useStoreTheme must be used within ThemeProvider');
  return ctx;
}
