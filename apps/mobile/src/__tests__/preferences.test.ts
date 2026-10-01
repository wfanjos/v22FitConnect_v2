import Storage from 'expo-sqlite/kv-store';

import {
  getLanguage,
  getThemeMode,
  LANGUAGES,
  setLanguage,
  setThemeMode,
  THEME_MODES,
} from '../preferences';

describe('preferences', () => {
  beforeEach(() => (Storage as unknown as { __clear: () => void }).__clear());
  afterEach(() => jest.restoreAllMocks());

  it('padrão: tema e idioma seguem o sistema', () => {
    expect(getThemeMode()).toBe('system');
    expect(getLanguage()).toBe('system');
  });

  it.each(THEME_MODES)('guarda e lê o tema %s', (mode) => {
    setThemeMode(mode);
    expect(getThemeMode()).toBe(mode);
  });

  it.each(LANGUAGES)('guarda e lê o idioma %s', (language) => {
    setLanguage(language);
    expect(getLanguage()).toBe(language);
  });

  it('tema e idioma são independentes', () => {
    setThemeMode('dark');
    expect(getLanguage()).toBe('system');
    setLanguage('es');
    expect(getThemeMode()).toBe('dark');
  });

  it('valor inválido guardado cai no padrão', () => {
    Storage.setItemSync('pref.themeMode', 'roxo');
    Storage.setItemSync('pref.language', 'fr');
    expect(getThemeMode()).toBe('system');
    expect(getLanguage()).toBe('system');
  });

  it('leitura que falha cai no padrão', () => {
    jest.spyOn(Storage, 'getItemSync').mockImplementationOnce(() => {
      throw new Error('sem armazenamento');
    });
    expect(getThemeMode()).toBe('system');
  });

  it('escrita que falha não lança erro', () => {
    jest.spyOn(Storage, 'setItemSync').mockImplementationOnce(() => {
      throw new Error('sem armazenamento');
    });
    expect(() => setThemeMode('dark')).not.toThrow();
  });
});
