// Fonte: docs/mockups/index.html. Archivo = títulos e números; Figtree = texto.
export type FontFamily = 'display' | 'body';
export type FontWeight = 400 | 500 | 600 | 700 | 800;

export const fontFamilies: Record<FontFamily, string> = {
  display: 'Archivo',
  body: 'Figtree',
};

export type TextStyleToken = {
  font: FontFamily;
  weight: FontWeight;
  size: number;
  lineHeight: number;
  letterSpacing?: number;
  uppercase?: boolean;
  tabularNums?: boolean;
};

export const textStyles = {
  title: { font: 'display', weight: 800, size: 24, lineHeight: 26, letterSpacing: -0.24 },
  display: { font: 'display', weight: 800, size: 30, lineHeight: 30, letterSpacing: -0.3 },
  number: { font: 'display', weight: 700, size: 26, lineHeight: 26, tabularNums: true },
  numberLg: { font: 'display', weight: 700, size: 30, lineHeight: 30, tabularNums: true },
  eyebrow: {
    font: 'display',
    weight: 700,
    size: 11,
    lineHeight: 11,
    letterSpacing: 1.32,
    uppercase: true,
  },
  appbarTitle: { font: 'body', weight: 700, size: 17, lineHeight: 20 },
  heading: { font: 'body', weight: 700, size: 15, lineHeight: 18 },
  body: { font: 'body', weight: 400, size: 15, lineHeight: 21 },
  bodyBold: { font: 'body', weight: 700, size: 15, lineHeight: 21 },
  listTitle: { font: 'body', weight: 700, size: 14.5, lineHeight: 20 },
  small: { font: 'body', weight: 400, size: 13, lineHeight: 18 },
  label: { font: 'body', weight: 600, size: 13, lineHeight: 13 },
  listSubtitle: { font: 'body', weight: 400, size: 12.5, lineHeight: 17 },
  caption: { font: 'body', weight: 400, size: 12, lineHeight: 17 },
  button: { font: 'body', weight: 700, size: 15, lineHeight: 15 },
  buttonSm: { font: 'body', weight: 700, size: 13, lineHeight: 13 },
  buttonXl: { font: 'body', weight: 700, size: 18, lineHeight: 18 },
  badge: { font: 'body', weight: 700, size: 11, lineHeight: 11 },
  tab: { font: 'body', weight: 600, size: 10.5, lineHeight: 10.5 },
} as const satisfies Record<string, TextStyleToken>;

export type TextStyleName = keyof typeof textStyles;
