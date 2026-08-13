import type { InputProps, InputSize } from './types';

type InputVariant = NonNullable<InputProps['variant']>;

/**
 * Resolve exactly one border color. NativeWind follows generated stylesheet
 * order rather than class-string order, so stacking default/focus/error border
 * utilities can otherwise let the default color override the active state.
 */
export const getInputBorderClass = (
  _variant: InputVariant,
  isFocused: boolean,
  hasError: boolean,
): string => {
  if (hasError) return 'border-danger';
  if (isFocused) return 'border-primary';
  return 'border-outline';
};

export const sizeContainerClass: Record<InputSize, string> = {
  sm: 'min-h-[40px] px-md',
  md: 'min-h-[48px] px-lg',
  lg: 'min-h-[56px] px-xl',
};

export const sizeInputClass: Record<InputSize, string> = {
  sm: 'text-md',
  md: 'text-md',
  lg: 'text-lg',
};
