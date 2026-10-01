// Fonte: docs/mockups/index.html (seção "Tamanhos e cantos" e CSS dos componentes).
export const space = {
  xxs: 4,
  xs: 6,
  sm: 8,
  sm2: 10, // espaço entre ícone e texto no campo
  md2: 11, // respiro vertical dos itens de lista
  md: 12,
  lg: 14,
  xl: 18, // margem lateral das telas
  xxl: 24,
} as const;

export const radius = {
  xs: 5,
  sm: 6, // selo
  md: 10, // botão pequeno, item do seletor
  lg: 12, // botão de ícone, miniatura, seletor
  xl: 14, // botão e campo
  card: 18,
  hero: 22,
  pill: 999,
} as const;

export const size = {
  button: 50,
  buttonSm: 36,
  buttonText: 40,
  buttonTreino: 64, // tela de treino: 64–68
  stepperTreino: 68,
  input: 50,
  iconButton: 40,
  chip: 32,
  minTouch: 44,
  screenMargin: space.xl,
  icon: 20,
  mascotFallback: 96, // símbolo da harpia no estado vazio, até existirem as poses do mascote
  focusRing: 3,
} as const;

export const border = {
  hairline: 1,
  regular: 1.5,
  icon: 2, // espessura do traço dos ícones Lucide
} as const;

export const opacity = {
  disabled: 0.5,
  pressed: 0.7,
  pressedCard: 0.8,
} as const;

export type Space = keyof typeof space;
export type Radius = keyof typeof radius;
