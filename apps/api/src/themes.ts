export type ThemePreset = {
  id: string;
  name: string;
  emoji: string;
  description: string;
};

/** 前台可选视觉模板；具体色值与布局由前端落地 */
export const THEME_PRESETS: ThemePreset[] = [
  {
    id: 'strawberry',
    name: '草莓甜心',
    emoji: '🍓',
    description: '粉嫩甜美圆角网格 · 少女心布局',
  },
  {
    id: 'guofeng',
    name: '天宫仙阙',
    emoji: '◇',
    description: '电影级写实仙侠 · 大气层光雾 · 奢侈编辑排版',
  },
  {
    id: 'angel',
    name: '神圣天使',
    emoji: '👼',
    description: '圣所杂志流 · 大留白与羽翼光晕',
  },
  {
    id: 'anime',
    name: '次元集市',
    emoji: '✨',
    description: '漫画分镜页 · 不规则面板与贴纸导航',
  },
];

/** 旧版科技风 id → 神圣天使 */
export const THEME_ID_ALIASES: Record<string, string> = {
  cyber: 'angel',
};

export const DEFAULT_THEME_ID = 'strawberry';

export function normalizeThemeId(id: string): string {
  return THEME_ID_ALIASES[id] || id;
}

export function isValidThemeId(id: string): boolean {
  const n = normalizeThemeId(id);
  return THEME_PRESETS.some((t) => t.id === n);
}
