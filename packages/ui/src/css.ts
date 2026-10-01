import { colors, type ThemeColors, type ThemeName } from './colors';
import { radius, size, space } from './layout';

const kebab = (key: string) => key.replace(/[A-Z0-9]/g, (c) => `-${c.toLowerCase()}`);

const toVars = (prefix: string, values: Record<string, string | number>, unit = '') =>
  Object.entries(values)
    .map(([key, value]) => `  --${prefix}-${kebab(key)}: ${value}${unit};`)
    .join('\n');

const colorVars = (theme: ThemeColors) => toVars('color', theme);

/**
 * Tokens como variáveis CSS para a web.
 * Tema claro/escuro seguem o sistema; `data-theme` no <html> força um deles.
 */
export function cssVariables(): string {
  const dark = colorVars(colors.dark);
  const light = colorVars(colors.light);
  const layout = [
    toVars('space', space, 'px'),
    toVars('radius', radius, 'px'),
    toVars('size', size, 'px'),
  ].join('\n');

  return [
    `:root {\n${layout}\n${light}\n  color-scheme: light;\n}`,
    `@media (prefers-color-scheme: dark) {\n  :root:not([data-theme='light']) {\n${dark.replace(/^/gm, '  ')}\n    color-scheme: dark;\n  }\n}`,
    `:root[data-theme='dark'] {\n${dark}\n  color-scheme: dark;\n}`,
    `:root[data-theme='light'] {\n${light}\n  color-scheme: light;\n}`,
  ].join('\n');
}

export type { ThemeName };
