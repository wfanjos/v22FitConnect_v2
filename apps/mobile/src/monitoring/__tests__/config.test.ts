import { DEFAULT_POSTHOG_HOST, getMonitoringConfig } from '../config';

const env = {
  EXPO_PUBLIC_SENTRY_DSN: 'https://abc@o1.ingest.us.sentry.io/2',
  EXPO_PUBLIC_POSTHOG_API_KEY: 'phc_test',
  EXPO_PUBLIC_POSTHOG_HOST: 'https://eu.i.posthog.com',
};

describe('getMonitoringConfig', () => {
  it('em desenvolvimento desliga tudo, mesmo com chaves', () => {
    expect(getMonitoringConfig(env, true)).toEqual({
      sentryDsn: null,
      posthogApiKey: null,
      posthogHost: DEFAULT_POSTHOG_HOST,
    });
  });

  it('fora do desenvolvimento usa as chaves do ambiente', () => {
    expect(getMonitoringConfig(env, false)).toEqual({
      sentryDsn: 'https://abc@o1.ingest.us.sentry.io/2',
      posthogApiKey: 'phc_test',
      posthogHost: 'https://eu.i.posthog.com',
    });
  });

  it('sem chave ou com chave em branco, a ferramenta fica desligada', () => {
    const config = getMonitoringConfig(
      { EXPO_PUBLIC_SENTRY_DSN: '', EXPO_PUBLIC_POSTHOG_API_KEY: '   ' },
      false,
    );
    expect(config.sentryDsn).toBeNull();
    expect(config.posthogApiKey).toBeNull();
  });

  it('sem host usa o da região EU', () => {
    expect(getMonitoringConfig({}, false).posthogHost).toBe('https://eu.i.posthog.com');
    expect(DEFAULT_POSTHOG_HOST).toContain('eu.');
  });

  it('remove espaços em volta dos valores', () => {
    expect(
      getMonitoringConfig({ EXPO_PUBLIC_POSTHOG_API_KEY: '  phc_x \n' }, false).posthogApiKey,
    ).toBe('phc_x');
  });
});
