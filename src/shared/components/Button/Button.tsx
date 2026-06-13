import React, { useCallback } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { impactLight } from '../../utils/haptics';
import { cn } from '../../utils/cn';
import {
  sizeContainerClass,
  sizeTextClass,
  variantContainerClass,
  variantPressedClass,
  variantTextClass,
} from './Button.styles';
import type { ButtonProps } from './types';

/**
 * Primary action button.
 *
 * - 5 `variant`s: `primary` (CTA, glow), `primaryContainer` (soft CTA), `ghost` (glass-like, filter pills),
 *   `outline`, `danger` (destructive).
 * - 3 `size`s (sm | md | lg) — all respect the 44pt minimum touch target.
 * - Triggers a light haptic on press-in when enabled.
 * - Either pass `label` (string) or children. Setting `loading` swaps to a spinner.
 *
 * @example
 * <Button label="Join" variant="primary" onPress={joinRoom} accessibilityHint="Joins this audio room" />
 */
export const Button: React.FC<ButtonProps> = ({
  label,
  children,
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  loading = false,
  disabled = false,
  leftIcon,
  rightIcon,
  style,
  textStyle,
  onPress,
  onPressIn,
  ...pressableProps
}) => {
  const isInactive = disabled || loading;

  const handlePressIn = useCallback(
    (e: Parameters<NonNullable<typeof onPressIn>>[0]) => {
      if (!isInactive) {
        impactLight();
      }
      onPressIn?.(e);
    },
    [isInactive, onPressIn],
  );

  return (
    <Pressable
      {...pressableProps}
      onPress={isInactive ? undefined : onPress}
      onPressIn={handlePressIn}
      disabled={isInactive}
      accessibilityRole="button"
      accessibilityState={{ disabled: isInactive, busy: loading }}
      style={style}
      className={cn(
        'flex-row items-center justify-center rounded-pill gap-sm',
        sizeContainerClass[size],
        variantContainerClass[variant],
        fullWidth && 'self-stretch',
        isInactive && 'opacity-45',
      )}
    >
      {({ pressed }) => (
        <View
          pointerEvents="none"
          className={cn(
            'flex-row items-center justify-center gap-sm',
            pressed && !isInactive && variantPressedClass[variant],
          )}
        >
          {leftIcon && !loading ? <View>{leftIcon}</View> : null}

          {loading ? (
            <ActivityIndicator />
          ) : label ? (
            <Text
              numberOfLines={1}
              className={cn(sizeTextClass[size], variantTextClass[variant])}
              style={textStyle}
            >
              {label}
            </Text>
          ) : (
            children
          )}

          {rightIcon && !loading ? <View>{rightIcon}</View> : null}
        </View>
      )}
    </Pressable>
  );
};
