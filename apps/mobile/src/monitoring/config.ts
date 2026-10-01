export type MonitoringConfig = {
  sentryDsn: string | null;
  posthogApiKey: string | null;
  posthogHost: string;
};

export const DEFAULT_POSTHOG_HOST = 'https://eu.i.posthog.com';

type Env = Record<string, string | undefined>;

const clean = (value: string | undefined) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

/**
 * Lê as chaves do ambiente. Em desenvolvimento (`__DEV__`) tudo fica desligado: os testes
 * do dia a dia não entram nos números de erro e de uso. Sem chave, a ferramenta fica desligada.
 */
export function getMonitoringConfig(env: Env, isDev: boolean): MonitoringConfig {
  if (isDev) {
    return { sentryDsn: null, posthogApiKey: null, posthogHost: DEFAULT_POSTHOG_HOST };
  }
  return {
    sentryDsn: clean(env.EXPO_PUBLIC_SENTRY_DSN),
    posthogApiKey: clean(env.EXPO_PUBLIC_POSTHOG_API_KEY),
    posthogHost: clean(env.EXPO_PUBLIC_POSTHOG_HOST) ?? DEFAULT_POSTHOG_HOST,
  };
}

// Importante: o Expo só troca `process.env.EXPO_PUBLIC_*` quando escrito por extenso, uma a uma.
export const monitoringConfig = getMonitoringConfig(
  {
    EXPO_PUBLIC_SENTRY_DSN: process.env.EXPO_PUBLIC_SENTRY_DSN,
    EXPO_PUBLIC_POSTHOG_API_KEY: process.env.EXPO_PUBLIC_POSTHOG_API_KEY,
    EXPO_PUBLIC_POSTHOG_HOST: process.env.EXPO_PUBLIC_POSTHOG_HOST,
  },
  __DEV__,
);
