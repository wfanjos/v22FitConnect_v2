import { size, space } from '@v22/ui';
import type { ReactNode } from 'react';
import { View } from 'react-native';

import { useTheme } from '@/theme/theme-provider';

import { Eagle } from './eagle';
import { Text } from './text';

export type EmptyStateProps = {
  title: string;
  description?: string;
  // Pose do mascote. Enquanto as poses não existem (docs/mascote/prompts.md), mostra o símbolo da harpia.
  illustration?: ReactNode;
  // Botões de ação (ex.: <Button />), empilhados abaixo do texto.
  children?: ReactNode;
};

export function EmptyState({ title, description, illustration, children }: EmptyStateProps) {
  const { colors } = useTheme();
  return (
    <View style={{ alignItems: 'center', gap: space.xl, padding: space.xxl }}>
      {illustration ?? <Eagle size={size.mascotFallback} color={colors.accent} />}
      <View style={{ alignItems: 'center', gap: space.xxs }}>
        <Text variant="title" accessibilityRole="header" style={{ textAlign: 'center' }}>
          {title}
        </Text>
        {description ? (
          <Text color="muted" style={{ textAlign: 'center' }}>
            {description}
          </Text>
        ) : null}
      </View>
      {children ? <View style={{ alignSelf: 'stretch', gap: space.md }}>{children}</View> : null}
    </View>
  );
}
