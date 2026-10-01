import type { TextStyleName, ThemeColors } from '@v22/ui';
import { Text as RNText, type TextProps as RNTextProps } from 'react-native';

import { textStyle } from '@/theme/text-style';
import { useTheme } from '@/theme/theme-provider';

export type TextProps = RNTextProps & {
  variant?: TextStyleName;
  color?: keyof ThemeColors;
};

export function Text({ variant = 'body', color = 'text', style, ...props }: TextProps) {
  const { colors } = useTheme();
  return <RNText {...props} style={[textStyle(variant), { color: colors[color] }, style]} />;
}
