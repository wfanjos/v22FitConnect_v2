import { act, renderHook, screen } from '@testing-library/react-native';
import { colors } from '@v22/ui';
import type { ReactNode } from 'react';
import { useColorScheme } from 'react-native';

import { Text } from '@/components/ui/text';
import { getThemeMode, setThemeMode } from '@/preferences';
import { renderThemed } from '@/test/render';

import { ThemeProvider, useTheme } from '../theme-provider';

// useColorScheme do RN importa getColorScheme direto, então o mock é do hook.
jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: jest.fn(),
}));

const wrapper = ({ children }: { children: ReactNode }) => (
  <ThemeProvider>{children}</ThemeProvider>
);

const mockSystem = (scheme: 'light' | 'dark' | null) =>
  jest.mocked(useColorScheme).mockReturnValue(scheme as never);

describe('ThemeProvider / useTheme', () => {
  beforeEach(() => setThemeMode('system'));
  afterEach(() => jest.restoreAllMocks());

  it('useTheme fora do provider lança erro', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    await expect(renderHook(() => useTheme())).rejects.toThrow(
      'useTheme precisa estar dentro de ThemeProvider',
    );
  });

  it('modo "system" segue o aparelho (escuro)', async () => {
    mockSystem('dark');
    const { result } = await renderHook(() => useTheme(), { wrapper });
    expect(result.current.mode).toBe('system');
    expect(result.current.name).toBe('dark');
    expect(result.current.colors).toBe(colors.dark);
  });

  it('modo "system" com aparelho claro usa o tema claro', async () => {
    mockSystem('light');
    const { result } = await renderHook(() => useTheme(), { wrapper });
    expect(result.current.name).toBe('light');
    expect(result.current.colors).toBe(colors.light);
  });

  it('modo "system" sem informação do aparelho cai no tema escuro', async () => {
    mockSystem(null);
    const { result } = await renderHook(() => useTheme(), { wrapper });
    expect(result.current.name).toBe('dark');
  });

  it('modo manual ignora o aparelho', async () => {
    mockSystem('dark');
    setThemeMode('light');
    const { result } = await renderHook(() => useTheme(), { wrapper });
    expect(result.current.mode).toBe('light');
    expect(result.current.name).toBe('light');
  });

  it('setMode troca o tema e persiste a escolha', async () => {
    mockSystem('dark');
    const { result } = await renderHook(() => useTheme(), { wrapper });

    await act(async () => result.current.setMode('light'));
    expect(result.current.name).toBe('light');
    expect(result.current.colors).toBe(colors.light);
    expect(getThemeMode()).toBe('light');

    await act(async () => result.current.setMode('dark'));
    expect(result.current.name).toBe('dark');
    expect(getThemeMode()).toBe('dark');

    await act(async () => result.current.setMode('system'));
    expect(result.current.mode).toBe('system');
    expect(getThemeMode()).toBe('system');
  });

  it('ao montar de novo lê a escolha persistida', async () => {
    mockSystem('dark');
    const first = await renderHook(() => useTheme(), { wrapper });
    await act(async () => first.result.current.setMode('light'));
    await first.unmount();

    const second = await renderHook(() => useTheme(), { wrapper });
    expect(second.result.current.mode).toBe('light');
    expect(second.result.current.name).toBe('light');
  });

  it('componentes consumidores recebem as cores do tema ativo', async () => {
    setThemeMode('light');
    await renderThemed(<Text>Olá</Text>);
    expect(screen.getByText('Olá')).toHaveStyle({ color: colors.light.text });
  });
});
