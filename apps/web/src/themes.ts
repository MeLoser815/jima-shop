export type ThemeId = 'strawberry' | 'guofeng' | 'angel' | 'anime';

export type ThemeTokens = {
  id: ThemeId;
  name: string;
  emoji: string;
  description: string;
  heroTitle: string;
  heroDesc: string;
  heroTag: string;
  primary: string;
  primarySoft: string;
  secondary: string;
  accent: string;
  text: string;
  muted: string;
  card: string;
  border: string;
  bg1: string;
  bg2: string;
  bg3: string;
  bgBase: string;
  candyFrom: string;
  candyMid: string;
  candyTo: string;
  heroFrom: string;
  heroMid: string;
  heroTo: string;
  antdPrimary: string;
  dark?: boolean;
  borderRadius?: number;
};

export const THEME_ID_ALIASES: Record<string, ThemeId> = {
  cyber: 'angel',
};

export const THEMES: Record<ThemeId, ThemeTokens> = {
  strawberry: {
    id: 'strawberry',
    name: '草莓甜心',
    emoji: '🍓',
    description: '粉嫩甜美圆角网格 · 少女心布局',
    heroTitle: '可爱好物，一扫即付 ✨',
    heroDesc: '精选治愈系周边 · 支付宝当面付秒出码 · 多套风格模板随心切换',
    heroTag: '即码小店 · 草莓甜心',
    primary: '#ff6b9d',
    primarySoft: '#ff8fb8',
    secondary: '#b8a4ff',
    accent: '#7dF0c5',
    text: 'rgba(40, 20, 40, 0.92)',
    muted: 'rgba(40, 20, 40, 0.55)',
    card: 'rgba(255,255,255,0.88)',
    border: 'rgba(255, 107, 157, 0.16)',
    bg1: 'rgba(255, 107, 157, 0.22)',
    bg2: 'rgba(184, 164, 255, 0.28)',
    bg3: 'rgba(125, 240, 197, 0.18)',
    bgBase: 'linear-gradient(180deg, #fff7fb 0%, #f3f0ff 45%, #eef8ff 100%)',
    candyFrom: '#ff6b9d',
    candyMid: '#ff8fb8',
    candyTo: '#b8a4ff',
    heroFrom: 'rgba(255,255,255,.92)',
    heroMid: 'rgba(255,232,244,.9)',
    heroTo: 'rgba(230,236,255,.92)',
    antdPrimary: '#ff6b9d',
    borderRadius: 16,
  },
  guofeng: {
    id: 'guofeng',
    name: '天宫仙阙',
    emoji: '◇',
    description: '电影级写实仙侠 · 大气层光雾 · 奢侈编辑排版',
    heroTitle: '云上仙阙',
    heroDesc: '石青月白 · 暗金微光 · 当面付静纳云藏',
    heroTag: 'TIAN GONG · 天宫仙阙',
    primary: '#5a7380',
    primarySoft: '#8fa3ad',
    secondary: '#9a7b3c',
    accent: '#b08a78',
    text: 'rgba(28, 36, 42, 0.92)',
    muted: 'rgba(90, 108, 118, 0.62)',
    card: 'rgba(252, 251, 248, 0.92)',
    border: 'rgba(154, 123, 60, 0.22)',
    bg1: 'rgba(90, 115, 128, 0.18)',
    bg2: 'rgba(176, 138, 120, 0.1)',
    bg3: 'rgba(236, 240, 242, 0.55)',
    bgBase:
      'linear-gradient(180deg, #3d5563 0%, #6d8794 22%, #b7c6ce 48%, #e7ecee 72%, #f7f6f3 100%)',
    candyFrom: '#5a7380',
    candyMid: '#9a7b3c',
    candyTo: '#b08a78',
    heroFrom: 'rgba(61, 85, 99, .4)',
    heroMid: 'rgba(183, 198, 206, .55)',
    heroTo: 'rgba(247, 246, 243, .92)',
    antdPrimary: '#5a7380',
    dark: false,
    borderRadius: 6,
  },
  angel: {
    id: 'angel',
    name: '神圣天使',
    emoji: '👼',
    description: '圣所杂志流 · 大留白与羽翼光晕',
    heroTitle: '圣光庇护 · 纯净好物',
    heroDesc: '金箔光环 · 羽翼琉璃 · 当面付温柔降临',
    heroTag: '圣所 · 神圣天使',
    primary: '#c9a227',
    primarySoft: '#e8d48b',
    secondary: '#f7f1ff',
    accent: '#ffe9a8',
    text: 'rgba(48, 36, 18, 0.9)',
    muted: 'rgba(90, 70, 40, 0.58)',
    card: 'rgba(255, 255, 255, 0.72)',
    border: 'rgba(201, 162, 39, 0.28)',
    bg1: 'rgba(255, 236, 180, 0.55)',
    bg2: 'rgba(255, 255, 255, 0.7)',
    bg3: 'rgba(230, 210, 255, 0.35)',
    bgBase:
      'linear-gradient(180deg, #fffdf8 0%, #fff6e4 38%, #f3eeff 72%, #fffaf0 100%)',
    candyFrom: '#e8d48b',
    candyMid: '#c9a227',
    candyTo: '#f5f0ff',
    heroFrom: 'rgba(255,255,255,.88)',
    heroMid: 'rgba(255,248,230,.9)',
    heroTo: 'rgba(245,240,255,.92)',
    antdPrimary: '#c9a227',
    borderRadius: 20,
  },
  anime: {
    id: 'anime',
    name: '次元集市',
    emoji: '✨',
    description: '漫画分镜页 · 不规则面板与贴纸导航',
    heroTitle: '闪闪出击！好物大作战',
    heroDesc: '分镜卡面 · 电光贴纸 · 当面付一秒变身',
    heroTag: 'ANIME BAZAAR',
    primary: '#ff2d6f',
    primarySoft: '#ff6b9d',
    secondary: '#6c5ce7',
    accent: '#00e5ff',
    text: 'rgba(20, 12, 40, 0.94)',
    muted: 'rgba(50, 30, 80, 0.58)',
    card: 'rgba(255, 255, 255, 0.96)',
    border: 'rgba(108, 92, 231, 0.28)',
    bg1: 'rgba(255, 45, 111, 0.2)',
    bg2: 'rgba(108, 92, 231, 0.18)',
    bg3: 'rgba(0, 229, 255, 0.16)',
    bgBase:
      'linear-gradient(145deg, #1a0a2e 0%, #2d1b4e 18%, #fff0f7 18.1%, #f0ecff 55%, #e6fbff 100%)',
    candyFrom: '#ff2d6f',
    candyMid: '#6c5ce7',
    candyTo: '#00e5ff',
    heroFrom: 'rgba(255,255,255,.97)',
    heroMid: 'rgba(255,220,240,.94)',
    heroTo: 'rgba(220,235,255,.96)',
    antdPrimary: '#ff2d6f',
    borderRadius: 14,
  },
};

export const THEME_LIST = Object.values(THEMES);

export function asThemeId(id: string | undefined | null): ThemeId {
  if (!id) return 'strawberry';
  const mapped = THEME_ID_ALIASES[id] || id;
  if (mapped in THEMES) return mapped as ThemeId;
  return 'strawberry';
}

export function applyThemeToDocument(theme: ThemeTokens) {
  const root = document.documentElement;
  root.dataset.theme = theme.id;
  const map: Record<string, string> = {
    '--primary': theme.primary,
    '--primary-soft': theme.primarySoft,
    '--secondary': theme.secondary,
    '--accent': theme.accent,
    '--text': theme.text,
    '--muted': theme.muted,
    '--card': theme.card,
    '--border': theme.border,
    '--bg1': theme.bg1,
    '--bg2': theme.bg2,
    '--bg3': theme.bg3,
    '--bg-base': theme.bgBase,
    '--candy-from': theme.candyFrom,
    '--candy-mid': theme.candyMid,
    '--candy-to': theme.candyTo,
    '--hero-from': theme.heroFrom,
    '--hero-mid': theme.heroMid,
    '--hero-to': theme.heroTo,
    '--pink': theme.primary,
    '--lavender': theme.secondary,
    '--mint': theme.accent,
  };
  for (const [k, v] of Object.entries(map)) root.style.setProperty(k, v);
  root.style.colorScheme = theme.dark ? 'dark' : 'light';
  document.body.classList.toggle('theme-dark', Boolean(theme.dark));
}
