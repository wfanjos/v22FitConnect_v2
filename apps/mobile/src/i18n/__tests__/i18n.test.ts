import { getLocales } from 'expo-localization';

import Storage from 'expo-sqlite/kv-store';

jest.mock('expo-localization', () => ({ getLocales: jest.fn() }));

const mockLocales = (...tags: string[]) =>
  (getLocales as jest.Mock).mockReturnValue(tags.map((languageTag) => ({ languageTag })));

// O módulo cria a instância ao ser importado, então cada teste importa de novo, isolado.
function load() {
  let mod: typeof import('..');
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- isolateModules exige require síncrono
    mod = require('..');
  });
  return mod!;
}

beforeEach(() => {
  (Storage as unknown as { __clear: () => void }).__clear();
  jest.clearAllMocks();
});

describe('idioma do app', () => {
  it('sem escolha salva, segue o aparelho', () => {
    mockLocales('es-MX', 'en-US');
    expect(load().i18n.language).toBe('es');
  });

  it('aparelho em idioma não suportado usa inglês', () => {
    mockLocales('fr-FR');
    expect(load().i18n.language).toBe('en');
  });

  it('escolha manual salva vale mais que o aparelho', () => {
    mockLocales('pt-BR');
    Storage.setItemSync('pref.language', 'en');
    expect(load().i18n.language).toBe('en');
  });

  it('"system" salvo volta a seguir o aparelho', () => {
    mockLocales('pt-BR');
    Storage.setItemSync('pref.language', 'system');
    expect(load().i18n.language).toBe('pt');
  });

  it('valor inválido salvo cai em seguir o aparelho', () => {
    mockLocales('es-ES');
    Storage.setItemSync('pref.language', 'klingon');
    expect(load().i18n.language).toBe('es');
  });
});

describe('changeAppLanguage', () => {
  it('troca o idioma e guarda a escolha', async () => {
    mockLocales('pt-BR');
    const { i18n, changeAppLanguage } = load();
    await changeAppLanguage('es');
    expect(i18n.language).toBe('es');
    expect(i18n.t('tabs.profile')).toBe('Perfil');
    expect(Storage.getItemSync('pref.language')).toBe('es');
  });

  it('voltar para "system" aplica o idioma do aparelho', async () => {
    mockLocales('pt-BR');
    const { i18n, changeAppLanguage } = load();
    await changeAppLanguage('en');
    expect(i18n.language).toBe('en');
    await changeAppLanguage('system');
    expect(i18n.language).toBe('pt');
    expect(Storage.getItemSync('pref.language')).toBe('system');
  });
});
