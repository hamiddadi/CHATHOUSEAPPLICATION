import React from 'react';
import { Text, View } from 'react-native';

interface EmptyStateProps {
  title: string;
  description?: string;
  children?: React.ReactNode;
}

export const EmptyState: React.FC<EmptyStateProps> = ({ title, description, children }) => (
  <View className="flex-1 items-center justify-center px-xxl gap-sm">
    <Text className="text-xl font-headline text-ink text-center">{title}</Text>
    {description ? (
      <Text className="text-md font-body text-ink-muted text-center">{description}</Text>
    ) : null}
    {children}
  </View>
);
