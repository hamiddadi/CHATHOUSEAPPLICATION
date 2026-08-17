import { clsx, type ClassValue } from 'clsx';

/**
 * Tiny helper to compose NativeWind/Tailwind classes conditionally.
 *
 * Usage:
 * ```tsx
 * <View className={cn('p-md rounded-md', isActive && 'bg-primary', className)} />
 * ```
 *
 * `cn` only joins conditional classes. Avoid supplying conflicting utilities:
 * NativeWind follows generated stylesheet order, not class-string order, so a
 * later class is not guaranteed to override an earlier one.
 */
export const cn = (...inputs: ClassValue[]): string => clsx(inputs);
