/**
 * Light theme — pragmatic inversion of the dark palette for opt-in
 * consumers. Keeps brand colors (primary, secondary, tertiary) identical
 * so the visual identity stays consistent; flips only surfaces, text,
 * borders, overlays.
 *
 * A proper design pass with Material 3 token roles would refine these
 * values further — for now this is enough for new components to render
 * correctly when ExtThemeProvider switches the app to "light".
 */
import {
  palette as darkPalette,
  spacing,
  radii,
  fontFamilies,
  fontSizes,
  fontWeights,
  lineHeights,
  letterSpacing,
} from '../constants/theme';

const lightPalette = {
  ...darkPalette,
  // Surfaces — flip to bright
  background: '#FFFFFF',
  surface: '#FFFFFF',
  surfaceDim: '#F1F5F9',
  surfaceBright: '#FFFFFF',
  surfaceContainerLowest: '#FFFFFF',
  surfaceContainerLow: '#F8FAFC',
  surfaceContainer: '#F1F5F9',
  surfaceContainerHigh: '#E2E8F0',
  surfaceContainerHighest: '#CBD5E1',
  surfaceVariant: '#E2E8F0',

  // Foreground
  onBackground: '#0F172A',
  onSurface: '#0F172A',
  onSurfaceVariant: '#475569',
  inverseSurface: '#0F172A',
  inverseOnSurface: '#FFFFFF',

  // Outlines
  outline: '#94A3B8',
  outlineVariant: '#E2E8F0',
} as const;

const lightColors = {
  background: lightPalette.background,
  surface: lightPalette.surface,
  surfaceAlt: lightPalette.surfaceContainer,
  surfaceHigh: lightPalette.surfaceContainerHigh,
  surfaceHighest: lightPalette.surfaceContainerHighest,
  surfaceLow: lightPalette.surfaceContainerLow,
  surfaceLowest: lightPalette.surfaceContainerLowest,

  text: lightPalette.onSurface,
  textMuted: lightPalette.onSurfaceVariant,
  textDim: '#64748B',
  textInverse: lightPalette.inverseOnSurface,

  primary: lightPalette.primary,
  onPrimary: lightPalette.onPrimary,
  primaryContainer: lightPalette.primaryContainer,
  onPrimaryContainer: lightPalette.onPrimaryContainer,

  secondary: lightPalette.secondary,
  onSecondary: lightPalette.onSecondary,

  accent: lightPalette.tertiary,
  onAccent: lightPalette.onTertiary,
  accentContainer: lightPalette.tertiaryContainer,

  border: lightPalette.outlineVariant,
  borderSoft: 'rgba(15,23,42,0.08)',
  outline: lightPalette.outline,

  success: lightPalette.tertiary,
  warning: lightPalette.gold,
  danger: lightPalette.error,
  info: lightPalette.primary,

  overlay: 'rgba(15, 23, 42, 0.5)',
  glass: 'rgba(15, 23, 42, 0.04)',
  glassStrong: 'rgba(15, 23, 42, 0.08)',

  overlayWhite3: 'rgba(15, 23, 42, 0.03)',
  overlayWhite4: 'rgba(15, 23, 42, 0.04)',
  overlayWhite5: 'rgba(15, 23, 42, 0.05)',
  overlayWhite6: 'rgba(15, 23, 42, 0.06)',
  overlayWhite7: 'rgba(15, 23, 42, 0.07)',
  overlayWhite10: 'rgba(15, 23, 42, 0.10)',
  overlayWhite12: 'rgba(15, 23, 42, 0.12)',
  overlayWhite20: 'rgba(15, 23, 42, 0.20)',
  overlayWhite30: 'rgba(15, 23, 42, 0.30)',
  overlayWhite70: 'rgba(15, 23, 42, 0.70)',
  overlayWhite75: 'rgba(15, 23, 42, 0.75)',
  overlayWhite80: 'rgba(15, 23, 42, 0.80)',

  overlayBlue50: 'rgba(77, 163, 255, 0.50)',

  gradientStart: '#FFFFFF',
  gradientMid: '#DBEAFE',
  gradientEnd: '#93C5FD',

  textWhite: '#FFFFFF',
  backgroundDark: '#0c112e',

  black: '#000000',
  white: '#FFFFFF',
  transparent: 'transparent' as const,
} as const;

export const lightTheme = {
  mode: 'light' as const,
  palette: lightPalette,
  colors: lightColors,
  spacing,
  radii,
  fontFamilies,
  fontSizes,
  fontWeights,
  lineHeights,
  letterSpacing,
} as const;
