import Storage from 'expo-sqlite/kv-store';

// Preferências do aparelho (tema, idioma). Ficam no SQLite local, junto do resto dos dados offline.
const KEYS = { themeMode: 'pref.themeMode', language: 'pref.language' } as const;

export const THEME_MODES = ['system', 'light', 'dark'] as const;
export type StoredThemeMode = (typeof THEME_MODES)[number];

// Idioma: 'system' segue o aparelho; os demais são a escolha manual.
export const LANGUAGES = ['system', 'pt', 'en', 'es'] as const;
export type StoredLanguage = (typeof LANGUAGES)[number];

function read<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const value = Storage.getItemSync(key);
    return allowed.find((item) => item === value) ?? fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: string) {
  try {
    Storage.setItemSync(key, value);
  } catch {
    // Sem armazenamento, a escolha vale só até fechar o app.
  }
}

export const getThemeMode = () => read(KEYS.themeMode, THEME_MODES, 'system');
export const setThemeMode = (mode: StoredThemeMode) => write(KEYS.themeMode, mode);

export const getLanguage = () => read(KEYS.language, LANGUAGES, 'system');
export const setLanguage = (language: StoredLanguage) => write(KEYS.language, language);
