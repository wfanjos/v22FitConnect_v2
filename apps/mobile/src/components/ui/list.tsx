import { border, opacity, size, space } from '@v22/ui';
import { ChevronRight } from 'lucide-react-native';
import { Children, isValidElement, type ReactNode } from 'react';
import { Pressable, View } from 'react-native';

import { useTheme } from '@/theme/theme-provider';

import { Text } from './text';

export type ListItemProps = {
  title: string;
  subtitle?: string;
  leading?: ReactNode;
  trailing?: ReactNode;
  onPress?: () => void;
};

const rowStyle = {
  flexDirection: 'row',
  alignItems: 'center',
  gap: space.md,
  paddingVertical: space.md2,
} as const;

export function ListItem({ title, subtitle, leading, trailing, onPress }: ListItemProps) {
  const { colors } = useTheme();
  const content = (
    <>
      {leading}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text variant="listTitle" numberOfLines={2}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="listSubtitle" color="muted" numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {trailing ??
        (onPress ? (
          <ChevronRight size={size.icon} color={colors.faint} strokeWidth={border.icon} />
        ) : null)}
    </>
  );

  if (!onPress) return <View style={rowStyle}>{content}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [rowStyle, { opacity: pressed ? opacity.pressed : 1 }]}
    >
      {content}
    </Pressable>
  );
}

// Lista com linha divisória entre os itens (sem linha depois do último).
export function List({ children }: { children: ReactNode }) {
  const { colors } = useTheme();
  const items = Children.toArray(children);
  return (
    <View>
      {items.map((item, index) => (
        <View
          key={isValidElement(item) && item.key !== null ? item.key : index}
          style={{
            borderBottomWidth: index < items.length - 1 ? border.hairline : 0,
            borderBottomColor: colors.line,
          }}
        >
          {item}
        </View>
      ))}
    </View>
  );
}
