import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

interface EmptyStateProps {
  title: string;
  description?: string;
  /** Label of the optional action button. Falls back to `common.retry`. */
  actionLabel?: string;
  /** When provided, renders a ≥44px action button below the texts. */
  onAction?: () => void;
  children?: React.ReactNode;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  title,
  description,
  actionLabel,
  onAction,
  children,
}) => {
  const { t } = useTranslation();

  return (
    <View className="flex-1 items-center justify-center px-xxl gap-sm">
      <Text className="text-xl font-headline text-ink text-center">{title}</Text>
      {description ? (
        <Text className="text-md font-body text-ink-muted text-center">{description}</Text>
      ) : null}
      {onAction ? (
        <Pressable
          onPress={onAction}
          accessibilityRole="button"
          className="bg-primary rounded-pill px-xxl py-md min-h-[44px] items-center justify-center"
        >
          <Text className="text-sm font-display text-primary-on">
            {actionLabel ?? t('common.retry', 'Retry')}
          </Text>
        </Pressable>
      ) : null}
      {children}
    </View>
  );
};
