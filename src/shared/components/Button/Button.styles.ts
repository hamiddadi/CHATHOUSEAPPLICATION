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

export const variantPressedClass: Record<ButtonVariant, string> = {
  primary: 'opacity-90',
  primaryContainer: 'opacity-85',
  ghost: 'bg-glass-strong',
  outline: 'bg-glass',
  danger: 'opacity-90',
};

export const variantTextClass: Record<ButtonVariant, string> = {
  primary: 'text-primary-on',
  primaryContainer: 'text-primary-on-container',
  ghost: 'text-ink-muted',
  outline: 'text-ink',
  danger: 'text-white',
};

export const sizeContainerClass: Record<ButtonSize, string> = {
  sm: 'px-xl py-sm min-h-[36px]',
  md: 'px-xxl py-[10px] min-h-[44px]',
  lg: 'px-xxxl py-md min-h-[52px]',
};

export const sizeTextClass: Record<ButtonSize, string> = {
  sm: 'text-xs font-display',
  md: 'text-sm font-display',
  lg: 'text-lg font-display',
};
