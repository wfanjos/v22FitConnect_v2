import { textStyles, type TextStyleName, type TextStyleToken } from '@v22/ui';
import type { TextStyle } from 'react-native';

import { fontFamilyName } from './fonts';

export function textStyle(name: TextStyleName): TextStyle {
  const token: TextStyleToken = textStyles[name];
  return {
    fontFamily: fontFamilyName(token.font, token.weight),
    fontSize: token.size,
    lineHeight: token.lineHeight,
    letterSpacing: token.letterSpacing,
    textTransform: token.uppercase ? 'uppercase' : undefined,
    fontVariant: token.tabularNums ? ['tabular-nums'] : undefined,
  };
}
