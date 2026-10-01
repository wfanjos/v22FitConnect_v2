import * as Sentry from '@sentry/react-native';

import { monitoringConfig } from './config';

// Erros do app (Sentry, plano grátis). Sem dados pessoais: sem IP, sem usuário, sem desempenho.
Sentry.init({
  dsn: monitoringConfig.sentryDsn ?? undefined,
  enabled: monitoringConfig.sentryDsn !== null,
  sendDefaultPii: false,
});

export { Sentry };
