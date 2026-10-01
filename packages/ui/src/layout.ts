// Fonte: docs/mockups/index.html (seção "Tamanhos e cantos" e CSS dos componentes).
export const space = {
  xxs: 4,
  xs: 6,
  sm: 8,
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
} as const;

export type Space = keyof typeof space;
export type Radius = keyof typeof radius;
