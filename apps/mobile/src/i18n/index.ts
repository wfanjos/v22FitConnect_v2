import { createI18n, isLanguage, resolveLanguage, type Language } from '@v22/i18n';
import { getLocales } from 'expo-localization';

import { getLanguage, setLanguage, type StoredLanguage } from '@/preferences';

// 'system' segue o idioma do aparelho (fora de PT/EN/ES, inglês); os demais são escolha manual.
export function resolveAppLanguage(preference: StoredLanguage): Language {
  if (isLanguage(preference)) return preference;
  return resolveLanguage(getLocales().map((locale) => locale.languageTag));
}

export const i18n = createI18n(resolveAppLanguage(getLanguage()));

export function changeAppLanguage(preference: StoredLanguage) {
  setLanguage(preference);
  return i18n.changeLanguage(resolveAppLanguage(preference));
}
