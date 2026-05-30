import { colors, palette } from '../../constants/theme';
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

const ROUNDED_RADIUS = 12;
const SQUIRCLE_RATIO = 0.32;

export const getShapeRadius = (shape: AvatarShape, size: number): number => {
  switch (shape) {
    case 'circle':
      return size / 2;
    case 'rounded':
      return ROUNDED_RADIUS;
    case 'squircle':
      return size * SQUIRCLE_RATIO;
    default:
      return size / 2;
  }
};

export const getStatusColor = (status: AvatarStatus): string => {
  switch (status) {
    case 'online':
      return colors.accent;
    case 'speaking':
      return colors.accent;
    case 'muted':
      return colors.danger;
    case 'offline':
      return palette.outline;
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
