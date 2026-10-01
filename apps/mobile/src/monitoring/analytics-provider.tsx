import { PostHogProvider } from 'posthog-react-native';
import type { ReactNode } from 'react';

import { monitoringConfig } from './config';

// Uso do app (PostHog, plano grátis, região EU). Sem identificar a pessoa: eventos anônimos,
// sem perfil, sem localização por IP, sem gravação de tela e sem captura de toques
// (docs/planejamento-app.md, "Aparência e monitoramento").
export function AnalyticsProvider({ children }: { children: ReactNode }) {
  if (!monitoringConfig.posthogApiKey) return <>{children}</>;

  return (
    <PostHogProvider
      apiKey={monitoringConfig.posthogApiKey}
      autocapture={{ captureTouches: false, captureScreens: true }}
      options={{
        host: monitoringConfig.posthogHost,
        personProfiles: 'never',
        disableGeoip: true,
        enableSessionReplay: false,
      }}
    >
      {children}
    </PostHogProvider>
  );
}
