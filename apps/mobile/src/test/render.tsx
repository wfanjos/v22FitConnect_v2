import { render, type RenderOptions } from '@testing-library/react-native';
import type { ReactElement } from 'react';

import { ThemeProvider } from '@/theme/theme-provider';

// Renderiza dentro do ThemeProvider, como o app faz no _layout.
export const renderThemed = (ui: ReactElement, options?: RenderOptions) =>
  render(ui, { wrapper: ThemeProvider, ...options });
