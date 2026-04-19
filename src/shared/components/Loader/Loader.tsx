import React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { cn } from '../../utils/cn';

interface LoaderProps {
  /** Fills the whole screen with the app background. */
  fullscreen?: boolean;
  size?: 'small' | 'large';
  color?: string;
  /** Announced by screen readers (defaults to "Loading"). */
  accessibilityLabel?: string;
}

const DEFAULT_COLOR = '#dee0ff';
const DEFAULT_LABEL = 'Loading';

export const Loader: React.FC<LoaderProps> = ({
  fullscreen,
  size = 'large',
  color = DEFAULT_COLOR,
  accessibilityLabel = DEFAULT_LABEL,
}) => (
  <View
    accessibilityRole="progressbar"
    accessibilityLiveRegion="polite"
    accessibilityLabel={accessibilityLabel}
    accessibilityState={{ busy: true }}
    className={cn('items-center justify-center p-lg', fullscreen && 'flex-1 bg-background')}
  >
    <ActivityIndicator size={size} color={color} />
  </View>
);
