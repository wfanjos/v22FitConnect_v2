// Português é o idioma de referência: en.ts e es.ts precisam ter exatamente as mesmas chaves.
// Só entram textos já definidos em docs/telas.md e nos mockups; os demais chegam com cada tela.
export const pt = {
  tabs: {
    home: 'Início',
    series: 'Séries',
    progress: 'Progresso',
    teachers: 'Professores',
    profile: 'Perfil',
    dashboard: 'Painel',
    students: 'Alunos',
    templates: 'Modelos',
  },
  languages: {
    pt: 'Português',
    en: 'English',
    es: 'Español',
  },
} as const;

type Widen<T> = { [K in keyof T]: T[K] extends string ? string : Widen<T[K]> };
export type Translation = Widen<typeof pt>;
