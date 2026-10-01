import { I18nextProvider } from '@v22/i18n';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';

import { i18n } from '@/i18n';
import { AnalyticsProvider } from '@/monitoring/analytics-provider';
import { Sentry } from '@/monitoring/sentry';
import { fontAssets } from '@/theme/fonts';
import { ThemeProvider, useTheme } from '@/theme/theme-provider';

SplashScreen.preventAutoHideAsync();

function Navigator() {
  const { name, colors } = useTheme();
  return (
    <>
      <StatusBar style={name === 'dark' ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }} />
    </>
  );
}

function RootLayout() {
  const [fontsLoaded, fontError] = useFonts(fontAssets);
  const ready = fontsLoaded || fontError !== null;

  useEffect(() => {
    if (ready) SplashScreen.hideAsync();
  }, [ready]);

  if (!ready) return null;

  return (
    <AnalyticsProvider>
      <I18nextProvider i18n={i18n}>
        <ThemeProvider>
          <Navigator />
        </ThemeProvider>
      </I18nextProvider>
    </AnalyticsProvider>
  );
}

// Sentry captura os erros não tratados da árvore de telas.
export default Sentry.wrap(RootLayout);
