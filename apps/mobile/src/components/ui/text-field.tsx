import { border, radius, size, space } from '@v22/ui';
import type { LucideIcon } from 'lucide-react-native';
import { useState } from 'react';
import { TextInput, View, type TextInputProps } from 'react-native';

import { textStyle } from '@/theme/text-style';
import { useTheme } from '@/theme/theme-provider';

import { Text } from './text';

export type TextFieldProps = Omit<TextInputProps, 'style'> & {
  label: string;
  icon?: LucideIcon;
  error?: string;
};

export function TextField({
  label,
  icon: Icon,
  error,
  onFocus,
  onBlur,
  accessibilityLabel,
  ...inputProps
}: TextFieldProps) {
  const { colors } = useTheme();
  const [focused, setFocused] = useState(false);

  return (
    <View style={{ gap: space.xs }}>
      <Text variant="label" color="muted" importantForAccessibility="no">
        {label}
      </Text>
      <View>
        {focused ? (
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              top: -size.focusRing,
              right: -size.focusRing,
              bottom: -size.focusRing,
              left: -size.focusRing,
              borderRadius: radius.xl + size.focusRing,
              borderWidth: size.focusRing,
              borderColor: colors.accentSoft,
            }}
          />
        ) : null}
        <View
          style={{
            minHeight: size.input,
            borderRadius: radius.xl,
            borderWidth: border.regular,
            borderColor: error || focused ? colors.accent : colors.line,
            backgroundColor: colors.surface,
            flexDirection: 'row',
            alignItems: 'center',
            gap: space.sm2,
            paddingHorizontal: space.lg,
          }}
        >
          {Icon ? <Icon size={size.icon} color={colors.muted} strokeWidth={border.icon} /> : null}
          <TextInput
            {...inputProps}
            accessibilityLabel={accessibilityLabel ?? label}
            accessibilityHint={error}
            placeholderTextColor={colors.faint}
            cursorColor={colors.accent}
            selectionColor={colors.accent}
            onFocus={(event) => {
              setFocused(true);
              onFocus?.(event);
            }}
            onBlur={(event) => {
              setFocused(false);
              onBlur?.(event);
            }}
            style={[textStyle('body'), { flex: 1, color: colors.text, padding: 0 }]}
          />
        </View>
      </View>
      {error ? (
        <Text variant="small" color="accent" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
    </View>
  );
}
