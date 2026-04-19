import { clsx, type ClassValue } from 'clsx';

/**
 * Tiny helper to compose NativeWind/Tailwind classes conditionally.
 *
 * Usage:
 * ```tsx
 * <View className={cn('p-md rounded-md', isActive && 'bg-primary', className)} />
 * ```
 *
 * NativeWind v4 resolves conflicting utilities by source order (last wins),
 * so `cn` does not need to merge à la `tailwind-merge`.
 */
export const cn = (...inputs: ClassValue[]): string => clsx(inputs);
