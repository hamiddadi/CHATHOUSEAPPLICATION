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
export const AVATAR_FALLBACK_TINTS = [
  colors.primaryContainer,
  palette.secondaryContainer,
  colors.accentContainer,
  colors.surfaceHigh,
  colors.primary,
];

export const getFallbackTint = (seed?: string): string => {
  if (!seed) return colors.surfaceHigh;
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  const idx = Math.abs(hash) % AVATAR_FALLBACK_TINTS.length;
  return AVATAR_FALLBACK_TINTS[idx] ?? colors.surfaceHigh;
};

const relativeLuminance = (hex: string): number => {
  const value = hex.replace('#', '');
  const channels = [0, 2, 4].map(offset => Number.parseInt(value.slice(offset, offset + 2), 16));
  const [red = 0, green = 0, blue = 0] = channels.map(channel => {
    const normalized = channel / 255;
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
};

const contrastRatio = (foreground: string, background: string): number => {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  return (
    (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
    (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
  );
};

/** Pick the more legible of the theme's light and dark text roles for a fallback tint. */
export const getFallbackForeground = (background: string): string =>
  contrastRatio(colors.text, background) >= contrastRatio(colors.background, background)
    ? colors.text
    : colors.background;
