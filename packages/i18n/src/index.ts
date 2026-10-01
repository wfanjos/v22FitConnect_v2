import i18next, { type i18n } from 'i18next';
import { initReactI18next } from 'react-i18next';

import { en } from './locales/en';
import { es } from './locales/es';
import { pt, type Translation } from './locales/pt';

export const supportedLanguages = ['pt', 'en', 'es'] as const;
export type Language = (typeof supportedLanguages)[number];

// Idioma do aparelho fora de PT/EN/ES: inglês (docs/planejamento-app.md).
export const fallbackLanguage: Language = 'en';

export const resources = {
  pt: { translation: pt },
  en: { translation: en },
  es: { translation: es },
} satisfies Record<Language, { translation: Translation }>;

export function isLanguage(value: unknown): value is Language {
  return supportedLanguages.some((language) => language === value);
}

/**
 * Escolhe o idioma do app a partir dos idiomas do aparelho, em ordem de preferência
 * (códigos como 'pt', 'pt-BR', 'es_MX'). Usa o primeiro suportado; se nenhum, inglês.
 */
export function resolveLanguage(deviceLanguages: readonly string[]): Language {
  for (const code of deviceLanguages) {
    const base = code.toLowerCase().split(/[-_]/)[0];
    if (isLanguage(base)) return base;
  }
  return fallbackLanguage;
}

/** Cria e inicializa a instância de i18next (síncrono: os textos já estão no pacote). */
export function createI18n(language: Language): i18n {
  const instance = i18next.createInstance();
  void instance.use(initReactI18next).init({
    resources,
    lng: language,
    fallbackLng: fallbackLanguage,
    supportedLngs: supportedLanguages,
    interpolation: { escapeValue: false },
    initAsync: false,
  });
  return instance;
}

export { I18nextProvider, useTranslation } from 'react-i18next';
export type { Translation };

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation';
    resources: { translation: Translation };
  }
}
