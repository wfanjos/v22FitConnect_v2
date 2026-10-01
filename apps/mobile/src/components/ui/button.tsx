import { border, opacity, radius, size, space } from '@v22/ui';
import type { LucideIcon } from 'lucide-react-native';
import { ActivityIndicator, Pressable, View, type StyleProp, type ViewStyle } from 'react-native';

import { useTheme } from '@/theme/theme-provider';

import { Text } from './text';

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'text';
export type ButtonSize = 'md' | 'sm' | 'xl';

export type ButtonProps = {
  label: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: LucideIcon;
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
};

const HEIGHT = { md: size.button, sm: size.buttonSm, xl: size.buttonTreino } as const;
const RADIUS = { md: radius.xl, sm: radius.md, xl: radius.card } as const;
const TEXT_STYLE = { md: 'button', sm: 'buttonSm', xl: 'buttonXl' } as const;

export function Button({
  label,
  onPress,
  variant = 'primary',
  size: buttonSize = 'md',
  icon: Icon,
  loading = false,
  disabled = false,
  style,
}: ButtonProps) {
  const { colors } = useTheme();
  const inactive = disabled || loading;
  const height = variant === 'text' && buttonSize === 'md' ? size.buttonText : HEIGHT[buttonSize];
  const foreground =
    variant === 'primary' ? colors.onAccent : variant === 'text' ? colors.accent : colors.text;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: inactive, busy: loading }}
      disabled={inactive}
      onPress={onPress}
      // Botões abaixo da área mínima de toque (44) ampliam a área sensível.
      hitSlop={{
        top: Math.max(0, (size.minTouch - height) / 2),
        bottom: Math.max(0, (size.minTouch - height) / 2),
      }}
      style={({ pressed }) => [
        {
          // minHeight (não height): com fonte grande do sistema o rótulo quebra em vez de ser cortado.
          minHeight: height,
          minWidth: size.minTouch,
          borderRadius: RADIUS[buttonSize],
          paddingHorizontal: buttonSize === 'sm' ? space.md : space.xl,
          alignSelf: buttonSize === 'sm' ? 'flex-start' : 'stretch',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor:
            variant === 'primary'
              ? pressed
                ? colors.accentPress
                : colors.accent
              : variant === 'secondary'
                ? colors.surface2
                : 'transparent',
          borderWidth: variant === 'outline' ? border.regular : 0,
          borderColor: colors.line,
          opacity: inactive
            ? opacity.disabled
            : pressed && variant !== 'primary'
              ? opacity.pressed
              : 1,
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={foreground} />
      ) : (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
          {Icon ? <Icon size={size.icon} color={foreground} strokeWidth={border.icon} /> : null}
          <Text
            variant={TEXT_STYLE[buttonSize]}
            style={{ color: foreground, flexShrink: 1, textAlign: 'center' }}
          >
            {label}
          </Text>
        </View>
      )}
    </Pressable>
  );
}
