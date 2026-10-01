import { colors, type ThemeColors, type ThemeName } from '@v22/ui';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';

import { getThemeMode, setThemeMode } from '@/preferences';

export type ThemeMode = 'system' | ThemeName;

type Theme = {
  name: ThemeName;
  colors: ThemeColors;
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
};

const ThemeContext = createContext<Theme | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme();
  const [mode, setModeState] = useState<ThemeMode>(getThemeMode);
  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    setThemeMode(next);
  }, []);

  const value = useMemo<Theme>(() => {
    const name: ThemeName = mode === 'system' ? (system === 'light' ? 'light' : 'dark') : mode;
    return { name, colors: colors[name], mode, setMode };
  }, [mode, setMode, system]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  const theme = useContext(ThemeContext);
  if (!theme) throw new Error('useTheme precisa estar dentro de ThemeProvider');
  return theme;
}
