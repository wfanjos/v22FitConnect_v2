import { fireEvent, screen } from '@testing-library/react-native';
import { darkColors } from '@v22/ui';
import { StyleSheet } from 'react-native';

import { setThemeMode } from '@/preferences';
import { renderThemed } from '@/test/render';

import { TextField } from '../text-field';

describe('TextField', () => {
  beforeEach(() => setThemeMode('dark'));

  it('mostra o rótulo e o usa como label acessível do input', async () => {
    await renderThemed(<TextField label="E-mail" />);
    expect(screen.getByText('E-mail')).toBeOnTheScreen();
    expect(screen.getByLabelText('E-mail')).toBeOnTheScreen();
  });

  it('accessibilityLabel explícito tem prioridade sobre o rótulo', async () => {
    await renderThemed(<TextField label="E-mail" accessibilityLabel="Campo de e-mail" />);
    expect(screen.getByLabelText('Campo de e-mail')).toBeOnTheScreen();
  });

  it('sem erro: não tem accessibilityHint', async () => {
    await renderThemed(<TextField label="E-mail" />);
    expect(screen.getByLabelText('E-mail').props.accessibilityHint).toBeUndefined();
  });

  it('com erro: exibe a mensagem e a liga ao input via accessibilityHint', async () => {
    await renderThemed(<TextField label="E-mail" error="E-mail inválido" />);
    expect(screen.getByText('E-mail inválido')).toBeOnTheScreen();
    expect(screen.getByLabelText('E-mail').props.accessibilityHint).toBe('E-mail inválido');
  });

  it('com erro: borda do campo usa a cor de destaque', async () => {
    await renderThemed(<TextField label="E-mail" error="Erro" />);
    const box = screen.getByLabelText('E-mail').parent!;
    expect(StyleSheet.flatten(box.props.style).borderColor).toBe(darkColors.accent);
  });

  it('sem erro e sem foco: borda usa a cor de linha', async () => {
    await renderThemed(<TextField label="E-mail" />);
    const box = screen.getByLabelText('E-mail').parent!;
    expect(StyleSheet.flatten(box.props.style).borderColor).toBe(darkColors.line);
  });

  it('foco e blur: alteram a borda e repassam os callbacks', async () => {
    const onFocus = jest.fn();
    const onBlur = jest.fn();
    await renderThemed(<TextField label="E-mail" onFocus={onFocus} onBlur={onBlur} />);
    const input = screen.getByLabelText('E-mail');
    const border = () => StyleSheet.flatten(input.parent!.props.style).borderColor;

    await fireEvent(input, 'focus');
    expect(onFocus).toHaveBeenCalledTimes(1);
    expect(border()).toBe(darkColors.accent);

    await fireEvent(input, 'blur');
    expect(onBlur).toHaveBeenCalledTimes(1);
    expect(border()).toBe(darkColors.line);
  });

  it('repassa onChangeText e props do TextInput', async () => {
    const onChangeText = jest.fn();
    await renderThemed(
      <TextField label="E-mail" placeholder="voce@exemplo.com" onChangeText={onChangeText} />,
    );
    await fireEvent.changeText(screen.getByLabelText('E-mail'), 'a@b.com');
    expect(onChangeText).toHaveBeenCalledWith('a@b.com');
    expect(screen.getByPlaceholderText('voce@exemplo.com')).toBeOnTheScreen();
  });
});
