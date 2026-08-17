import type { Insets, ViewStyle } from 'react-native';
import { colors, palette } from '../../constants/theme';
import type { ButtonSize, ButtonVariant } from './types';

/**
 * NativeWind class maps for Button.
 * Kept in one module so variants stay discoverable and testable.
 */

export const variantContainerClass: Record<ButtonVariant, string> = {
  primary: 'bg-primary shadow-glow-primary',
  primaryContainer: 'bg-primary-container',
  ghost: 'bg-glass border border-glass-strong',
  outline: 'bg-transparent border border-outline',
  danger: 'bg-danger',
};

/** Inline pressed styles belong to the Pressable surface, not its contents. */
export const variantPressedStyle: Record<ButtonVariant, ViewStyle> = {
  primary: { opacity: 0.9 },
  primaryContainer: { opacity: 0.85 },
  ghost: { backgroundColor: colors.glassStrong },
  outline: { backgroundColor: colors.glass },
  danger: { opacity: 0.9 },
};

export const variantTextClass: Record<ButtonVariant, string> = {
  primary: 'text-primary-on',
  primaryContainer: 'text-primary-on-container',
  ghost: 'text-ink-muted',
  outline: 'text-ink',
  danger: 'text-on-danger',
};

export const variantIndicatorColor: Record<ButtonVariant, string> = {
  primary: colors.onPrimary,
  primaryContainer: colors.onPrimaryContainer,
  ghost: colors.text,
  outline: colors.text,
  danger: palette.onError,
};

export const sizeContainerClass: Record<ButtonSize, string> = {
  sm: 'px-xl py-sm min-h-[36px]',
  md: 'px-xxl py-[10px] min-h-[44px]',
  lg: 'px-xxxl py-md min-h-[52px]',
};

/**
 * `sm` renders 36px tall (min-h above), so it gets an automatic compensating
 * hitSlop stretching the effective touch target to the 44pt minimum without
 * changing the visual size. `md`/`lg` already meet 44pt visually.
 */
export const sizeHitSlop: Record<ButtonSize, Insets | undefined> = {
  sm: { top: 4, bottom: 4 },
  md: undefined,
  lg: undefined,
};

export const sizeTextClass: Record<ButtonSize, string> = {
  sm: 'text-xs font-display',
  md: 'text-sm font-display',
  lg: 'text-lg font-display',
};
