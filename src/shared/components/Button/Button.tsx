import React, { useCallback } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { impactLight } from '../../utils/haptics';
import { cn } from '../../utils/cn';
import {
  sizeContainerClass,
  sizeHitSlop,
  sizeTextClass,
  variantContainerClass,
  variantIndicatorColor,
  variantPressedStyle,
  variantTextClass,
} from './Button.styles';
import type { ButtonProps } from './types';

/**
 * Primary action button.
 *
 * - 5 `variant`s: `primary` (CTA, glow), `primaryContainer` (soft CTA), `ghost` (glass-like, filter pills),
 *   `outline`, `danger` (destructive).
 * - 3 `size`s (sm | md | lg) — every size keeps an effective touch target of at least 44pt:
 *   `md`/`lg` visually, `sm` (36px tall) via an automatic compensating vertical `hitSlop`
 *   (skipped when the caller passes their own `hitSlop`).
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
  hitSlop,
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
      hitSlop={hitSlop === undefined ? sizeHitSlop[size] : hitSlop}
      onPress={isInactive ? undefined : onPress}
      onPressIn={handlePressIn}
      disabled={isInactive}
      accessibilityRole="button"
      accessibilityLabel={pressableProps.accessibilityLabel ?? label}
      accessibilityState={{ disabled: isInactive, busy: loading }}
      style={({ pressed }) => [
        style,
        pressed && !isInactive ? variantPressedStyle[variant] : undefined,
      ]}
      className={cn(
        'flex-row items-center justify-center rounded-pill gap-sm',
        sizeContainerClass[size],
        variantContainerClass[variant],
        fullWidth && 'self-stretch',
        disabled && !loading && 'opacity-45',
      )}
    >
      <View pointerEvents="none" style={styles.contentFrame}>
        <View
          className="flex-row items-center justify-center gap-sm"
          style={loading ? styles.loadingPlaceholder : undefined}
        >
          {leftIcon ? <View>{leftIcon}</View> : null}

          {label ? (
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

          {rightIcon ? <View>{rightIcon}</View> : null}
        </View>
        {loading ? (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator color={variantIndicatorColor[variant]} />
          </View>
        ) : null}
      </View>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  contentFrame: { position: 'relative' },
  loadingPlaceholder: { opacity: 0 },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
