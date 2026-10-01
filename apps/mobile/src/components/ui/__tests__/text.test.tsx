import { screen } from '@testing-library/react-native';
import { darkColors, lightColors, textStyles } from '@v22/ui';
import { StyleSheet } from 'react-native';

import { setThemeMode } from '@/preferences';
import { renderThemed } from '@/test/render';
import { fontFamilyName } from '@/theme/fonts';

import { Text } from '../text';

const styleOf = (text = 'Olá') => StyleSheet.flatten(screen.getByText(text).props.style);

describe('Text', () => {
  beforeEach(() => setThemeMode('dark'));

  it('por padrão usa a variante body e a cor de texto do tema', async () => {
    await renderThemed(<Text>Olá</Text>);
    expect(styleOf()).toMatchObject({
      fontFamily: fontFamilyName('body', 400),
      fontSize: textStyles.body.size,
      lineHeight: textStyles.body.lineHeight,
      color: darkColors.text,
    });
  });

  it('variante vem dos tokens de tipografia', async () => {
    await renderThemed(<Text variant="title">Olá</Text>);
    expect(styleOf()).toMatchObject({
      fontFamily: fontFamilyName('display', 800),
      fontSize: textStyles.title.size,
      letterSpacing: textStyles.title.letterSpacing,
    });
  });

  it('eyebrow vira maiúsculas; number usa números tabulares', async () => {
    await renderThemed(
      <>
        <Text variant="eyebrow">Olá</Text>
        <Text variant="number">42</Text>
      </>,
    );
    expect(styleOf().textTransform).toBe('uppercase');
    expect(styleOf('42').fontVariant).toEqual(['tabular-nums']);
  });

  it('color escolhe um token de cor do tema', async () => {
    await renderThemed(<Text color="muted">Olá</Text>);
    expect(styleOf().color).toBe(darkColors.muted);
  });

  it('no tema claro usa as cores do tema claro', async () => {
    setThemeMode('light');
    await renderThemed(<Text>Olá</Text>);
    expect(styleOf().color).toBe(lightColors.text);
  });

  it('style recebido sobrescreve os tokens', async () => {
    await renderThemed(<Text style={{ color: 'red' }}>Olá</Text>);
    expect(styleOf().color).toBe('red');
  });
});
