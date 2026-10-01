import { colors, cssVariables, darkColors, lightColors, type ThemeColors } from '../index';

const HEX = /^#[0-9A-F]{6}$/i;
const RGBA = /^rgba\(\d{1,3},\s?\d{1,3},\s?\d{1,3},\s?(0|1|0?\.\d+)\)$/;
const isColor = (value: string) => HEX.test(value) || RGBA.test(value);

const keys = (theme: ThemeColors) => Object.keys(theme).sort();
const kebab = (key: string) => key.replace(/[A-Z0-9]/g, (c) => `-${c.toLowerCase()}`);

describe('paletas de cores', () => {
  it('colors expõe os temas dark e light', () => {
    expect(colors.dark).toBe(darkColors);
    expect(colors.light).toBe(lightColors);
  });

  it('dark e light têm exatamente as mesmas chaves', () => {
    expect(keys(darkColors)).toEqual(keys(lightColors));
  });

  it.each([
    ['dark', darkColors],
    ['light', lightColors],
  ] as const)('tema %s: todo valor é hex #RRGGBB ou rgba() válido', (_name, theme) => {
    for (const [key, value] of Object.entries(theme)) {
      expect({ key, valid: isColor(value) }).toEqual({ key, valid: true });
    }
  });

  it('tokens principais do tema escuro (CLAUDE.md, tabela de cores)', () => {
    expect(darkColors).toMatchObject({
      bg: '#040C19',
      surface: '#0B172A',
      surface2: '#132440',
      line: '#1D2E4B',
      text: '#EFE8D8',
      muted: '#8E9AB1',
      accent: '#C8323D',
      accentPress: '#A92631',
      onAccent: '#FFF6EA',
    });
  });

  it('tokens principais do tema claro (CLAUDE.md, tabela de cores)', () => {
    expect(lightColors).toMatchObject({
      bg: '#F5EFE3',
      surface: '#FFFCF6',
      surface2: '#ECE4D3',
      line: '#DED4C0',
      text: '#0A2143',
      muted: '#5B6781',
      accent: '#AF2530',
      accentPress: '#921C27',
      onAccent: '#FFF8EE',
    });
  });

  it('cartão "Treino de hoje": vinho no escuro, marinho no claro (CLAUDE.md)', () => {
    expect(darkColors.hero).toBe('#2A0C14');
    expect(lightColors.hero).toBe('#0A2143');
  });

  it('os dois temas diferem em fundo, texto e destaque', () => {
    expect(darkColors.bg).not.toBe(lightColors.bg);
    expect(darkColors.text).not.toBe(lightColors.text);
    expect(darkColors.accent).not.toBe(lightColors.accent);
  });
});

describe('cssVariables()', () => {
  const css = cssVariables();
  const colorKeys = Object.keys(darkColors);

  it('gera os 4 blocos esperados', () => {
    expect(css).toContain(':root {');
    expect(css).toContain('@media (prefers-color-scheme: dark) {');
    expect(css).toContain(":root:not([data-theme='light'])");
    expect(css).toContain(":root[data-theme='dark'] {");
    expect(css).toContain(":root[data-theme='light'] {");
  });

  it('o bloco :root padrão é claro e o escuro vem do sistema ou de data-theme', () => {
    const root = css.slice(0, css.indexOf('@media'));
    expect(root).toContain(`--color-bg: ${lightColors.bg};`);
    expect(root).toContain('color-scheme: light;');
    const media = css.slice(css.indexOf('@media'), css.indexOf(":root[data-theme='dark']"));
    expect(media).toContain(`--color-bg: ${darkColors.bg};`);
    expect(media).toContain('color-scheme: dark;');
  });

  it('data-theme força cada tema com as cores certas', () => {
    const darkStart = css.indexOf(":root[data-theme='dark'] {");
    const lightStart = css.indexOf(":root[data-theme='light'] {");
    const darkBlock = css.slice(darkStart, lightStart);
    const lightBlock = css.slice(lightStart);
    expect(darkBlock).toContain(`--color-accent: ${darkColors.accent};`);
    expect(darkBlock).toContain('color-scheme: dark;');
    expect(lightBlock).toContain(`--color-accent: ${lightColors.accent};`);
    expect(lightBlock).toContain('color-scheme: light;');
  });

  it('declara uma variável --color-* por token de cor em cada bloco de cor (4 blocos)', () => {
    for (const key of colorKeys) {
      const name = `--color-${kebab(key)}:`;
      expect({ name, count: css.split(name).length - 1 }).toEqual({ name, count: 4 });
    }
    const total = css.match(/--color-[a-z0-9-]+:/g) ?? [];
    expect(total).toHaveLength(colorKeys.length * 4);
  });

  it('nomes em kebab-case (accentPress vira --color-accent-press, surface2 vira --color-surface-2)', () => {
    expect(css).toContain('--color-accent-press:');
    expect(css).toContain('--color-surface-2:');
  });

  it('inclui variáveis de espaço, raio e tamanho em px', () => {
    expect(css).toContain('--space-xl: 18px;');
    expect(css).toContain('--radius-card: 18px;');
    expect(css).toContain('--size-min-touch: 44px;');
  });

  it('chaves balanceadas', () => {
    expect(css.split('{').length).toBe(css.split('}').length);
  });
});
