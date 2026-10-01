import {
  createI18n,
  fallbackLanguage,
  isLanguage,
  resolveLanguage,
  resources,
  supportedLanguages,
} from '..';

const keysOf = (value: object, prefix = ''): string[] =>
  Object.entries(value).flatMap(([key, child]) =>
    typeof child === 'string' ? [`${prefix}${key}`] : keysOf(child, `${prefix}${key}.`),
  );

const textsOf = (value: object): string[] =>
  Object.values(value).flatMap((child) => (typeof child === 'string' ? [child] : textsOf(child)));

describe('resolveLanguage', () => {
  it.each([
    [['pt-BR'], 'pt'],
    [['pt'], 'pt'],
    [['en-US'], 'en'],
    [['es-MX'], 'es'],
    [['es_AR'], 'es'],
    [['PT-br'], 'pt'],
  ])('%j → %s', (device, expected) => {
    expect(resolveLanguage(device)).toBe(expected);
  });

  it('usa o primeiro idioma suportado, na ordem do aparelho', () => {
    expect(resolveLanguage(['fr-FR', 'es-ES', 'pt-BR'])).toBe('es');
  });

  it('cai em inglês quando nenhum é suportado ou a lista é vazia', () => {
    expect(resolveLanguage(['fr-FR', 'de-DE', 'ja-JP'])).toBe('en');
    expect(resolveLanguage([])).toBe('en');
    expect(fallbackLanguage).toBe('en');
  });

  it('não confunde códigos que só começam parecido', () => {
    expect(resolveLanguage(['pl-PL'])).toBe('en');
    expect(resolveLanguage(['esperanto'])).toBe('en');
  });
});

describe('isLanguage', () => {
  it('aceita só pt, en e es', () => {
    expect(supportedLanguages.every(isLanguage)).toBe(true);
    expect(isLanguage('system')).toBe(false);
    expect(isLanguage('fr')).toBe(false);
    expect(isLanguage(undefined)).toBe(false);
  });
});

describe('textos', () => {
  const reference = keysOf(resources.pt.translation).sort();

  it.each(['en', 'es'] as const)('%s tem exatamente as mesmas chaves do português', (language) => {
    expect(keysOf(resources[language].translation).sort()).toEqual(reference);
  });

  it.each(supportedLanguages)('%s não tem texto vazio', (language) => {
    for (const text of textsOf(resources[language].translation)) {
      expect(text.trim()).not.toBe('');
    }
  });

  it('os nomes dos idiomas aparecem no próprio idioma em todas as línguas', () => {
    for (const language of supportedLanguages) {
      expect(resources[language].translation.languages).toEqual({
        pt: 'Português',
        en: 'English',
        es: 'Español',
      });
    }
  });
});

describe('createI18n', () => {
  it.each([
    ['pt', 'Início'],
    ['en', 'Home'],
    ['es', 'Inicio'],
  ] as const)('traduz no idioma %s', (language, home) => {
    expect(createI18n(language).t('tabs.home')).toBe(home);
  });

  it('troca de idioma em tempo de execução', async () => {
    const i18n = createI18n('pt');
    await i18n.changeLanguage('es');
    expect(i18n.t('tabs.students')).toBe('Alumnos');
  });

  it('instâncias são independentes', () => {
    const a = createI18n('pt');
    const b = createI18n('en');
    expect(a.t('tabs.profile')).toBe('Perfil');
    expect(b.t('tabs.profile')).toBe('Profile');
  });
});
