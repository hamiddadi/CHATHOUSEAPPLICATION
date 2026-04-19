import type { InputSize } from './types';

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
