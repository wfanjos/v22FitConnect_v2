import { border, opacity, radius, space } from '@v22/ui';
import { Pressable, View, type StyleProp, type ViewProps, type ViewStyle } from 'react-native';

import { useTheme } from '@/theme/theme-provider';

export type CardProps = ViewProps & {
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
};

export function Card({ onPress, style, children, ...props }: CardProps) {
  const { colors } = useTheme();
  const base: ViewStyle = {
    backgroundColor: colors.surface,
    borderWidth: border.hairline,
    borderColor: colors.line,
    borderRadius: radius.card,
    padding: space.lg,
  };

  if (onPress) {
    return (
      <Pressable
        accessibilityRole="button"
        {...props}
        onPress={onPress}
        style={({ pressed }) => [base, { opacity: pressed ? opacity.pressedCard : 1 }, style]}
      >
        {children}
      </Pressable>
    );
  }

  return (
    <View {...props} style={[base, style]}>
      {children}
    </View>
  );
}
