import type { AvatarShape, AvatarSize, AvatarStatus } from './types';

export const AVATAR_SIZE_MAP: Record<AvatarSize, number> = {
  xs: 24,
  sm: 32,
  md: 44,
  lg: 56,
  xl: 72,
  xxl: 96,
};

export const INITIALS_FONT_RATIO = 0.42;
export const STATUS_DOT_RATIO = 0.26;
export const STATUS_BORDER_RATIO = 0.06;

export const getShapeRadius = (shape: AvatarShape, size: number): number => {
  switch (shape) {
    case 'circle':
      return size / 2;
    case 'rounded':
      return 12;
    case 'squircle':
      return size * 0.32;
    default:
      return size / 2;
  }
};

export const getStatusColor = (status: AvatarStatus): string => {
  switch (status) {
    case 'online':
      return '#00e475';
    case 'speaking':
      return '#00e475';
    case 'muted':
      return '#ffb4ab';
    case 'offline':
      return '#8c90a0';
    case 'none':
    default:
      return 'transparent';
  }
};

/** Deterministic fallback tint so the same seed always produces the same color. */
const FALLBACK_TINTS = ['#558dff', '#2f3f92', '#00a754', '#232846', '#b0c6ff'];

export const getFallbackTint = (seed?: string): string => {
  if (!seed) return '#232846';
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  const idx = Math.abs(hash) % FALLBACK_TINTS.length;
  return FALLBACK_TINTS[idx] ?? '#232846';
};
