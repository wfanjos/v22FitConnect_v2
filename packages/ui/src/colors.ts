export type ThemeName = 'dark' | 'light';

export type ThemeColors = {
  bg: string;
  surface: string;
  surface2: string;
  line: string;
  text: string;
  muted: string;
  faint: string;
  accent: string;
  accentPress: string;
  onAccent: string;
  accentSoft: string;
  ok: string;
  warn: string;
  gold: string;
  info: string;
  // Cartão "Treino de hoje": vinho no tema escuro, marinho no claro.
  hero: string;
  hero2: string;
  heroText: string;
  heroMuted: string;
  heroMark: string;
  heroGhost: string;
  heroCta: string;
  heroCtaText: string;
  heroBorder: string;
};

// Fonte: docs/mockups/index.html (tokens por tema).
export const darkColors: ThemeColors = {
  bg: '#040C19',
  surface: '#0B172A',
  surface2: '#132440',
  line: '#1D2E4B',
  text: '#EFE8D8',
  muted: '#8E9AB1',
  faint: '#5A6883',
  accent: '#C8323D',
  accentPress: '#A92631',
  onAccent: '#FFF6EA',
  accentSoft: 'rgba(200,50,61,0.16)',
  ok: '#43BC8C',
  warn: '#E9A23B',
  gold: '#E4B54F',
  info: '#6FA3E8',
  hero: '#2A0C14',
  hero2: '#5A1620',
  heroText: '#F6EDDB',
  heroMuted: '#D6B4B6',
  heroMark: 'rgba(232,72,84,0.32)',
  heroGhost: 'rgba(255,255,255,0.1)',
  heroCta: '#F6EDDB',
  heroCtaText: '#6E1824',
  heroBorder: '#6B1E2A',
};

export const lightColors: ThemeColors = {
  bg: '#F5EFE3',
  surface: '#FFFCF6',
  surface2: '#ECE4D3',
  line: '#DED4C0',
  text: '#0A2143',
  muted: '#5B6781',
  faint: '#98A0B2',
  accent: '#AF2530',
  accentPress: '#921C27',
  onAccent: '#FFF8EE',
  accentSoft: 'rgba(175,37,48,0.1)',
  ok: '#1D8659',
  warn: '#A96A12',
  gold: '#9A700E',
  info: '#2A5FA8',
  hero: '#0A2143',
  hero2: '#12305C',
  heroText: '#F6EDDB',
  heroMuted: '#AEBAD0',
  heroMark: 'rgba(200,50,61,0.38)',
  heroGhost: 'rgba(255,255,255,0.1)',
  heroCta: '#AF2530',
  heroCtaText: '#FFF8EE',
  heroBorder: '#0A2143',
};

export const colors: Record<ThemeName, ThemeColors> = {
  dark: darkColors,
  light: lightColors,
};
