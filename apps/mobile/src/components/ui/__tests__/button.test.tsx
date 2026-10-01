import { screen, fireEvent, userEvent } from '@testing-library/react-native';
import { darkColors, lightColors, opacity } from '@v22/ui';
import { StyleSheet, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';

import { setThemeMode } from '@/preferences';
import { renderThemed } from '@/test/render';

import { Button } from '../button';

const flat = (node: { props: { style?: unknown } }) =>
  StyleSheet.flatten(node.props.style as StyleProp<ViewStyle & TextStyle>) as ViewStyle & TextStyle;

describe('Button', () => {
  beforeEach(() => setThemeMode('dark'));

  it('expõe role button e o rótulo como label acessível', async () => {
    await renderThemed(<Button label="Entrar" />);
    expect(screen.getByRole('button', { name: 'Entrar' })).toBeOnTheScreen();
    expect(screen.getByText('Entrar')).toBeOnTheScreen();
  });

  it('dispara onPress quando ativo', async () => {
    const onPress = jest.fn();
    await renderThemed(<Button label="Entrar" onPress={onPress} />);
    await userEvent.press(screen.getByRole('button', { name: 'Entrar' }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('não dispara onPress quando disabled', async () => {
    const onPress = jest.fn();
    await renderThemed(<Button label="Entrar" onPress={onPress} disabled />);
    const button = screen.getByRole('button', { name: 'Entrar' });
    await fireEvent.press(button);
    await userEvent.press(button);
    expect(onPress).not.toHaveBeenCalled();
    expect(button).toBeDisabled();
  });

  it('em loading: mostra indicador, esconde o rótulo, marca busy e não dispara onPress', async () => {
    const onPress = jest.fn();
    await renderThemed(<Button label="Entrar" onPress={onPress} loading />);
    const button = screen.getByRole('button', { name: 'Entrar' });
    expect(screen.queryByText('Entrar')).not.toBeOnTheScreen();
    expect(button).toBeBusy();
    expect(button).toBeDisabled();
    await fireEvent.press(button);
    expect(onPress).not.toHaveBeenCalled();
  });

  it('inativo usa a opacidade de desabilitado', async () => {
    await renderThemed(<Button label="Entrar" disabled />);
    expect(flat(screen.getByRole('button')).opacity).toBe(opacity.disabled);
  });

  it('primary usa a cor de destaque do tema escuro', async () => {
    await renderThemed(<Button label="Entrar" />);
    expect(flat(screen.getByRole('button')).backgroundColor).toBe(darkColors.accent);
    expect(flat(screen.getByText('Entrar')).color).toBe(darkColors.onAccent);
  });

  it('primary usa a cor de destaque do tema claro', async () => {
    setThemeMode('light');
    await renderThemed(<Button label="Entrar" />);
    expect(flat(screen.getByRole('button')).backgroundColor).toBe(lightColors.accent);
    expect(flat(screen.getByText('Entrar')).color).toBe(lightColors.onAccent);
  });

  it('variantes secondary, outline e text têm fundo/borda próprios', async () => {
    await renderThemed(
      <>
        <Button label="Sec" variant="secondary" />
        <Button label="Out" variant="outline" />
        <Button label="Txt" variant="text" />
      </>,
    );
    expect(flat(screen.getByRole('button', { name: 'Sec' })).backgroundColor).toBe(
      darkColors.surface2,
    );
    const outline = flat(screen.getByRole('button', { name: 'Out' }));
    expect(outline.backgroundColor).toBe('transparent');
    expect(outline.borderWidth).toBeGreaterThan(0);
    expect(outline.borderColor).toBe(darkColors.line);
    expect(flat(screen.getByText('Txt')).color).toBe(darkColors.accent);
  });
});
