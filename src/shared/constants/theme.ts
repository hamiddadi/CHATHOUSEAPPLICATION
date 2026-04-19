/**
 * Chathouse Design System — Material 3 Dark
 * Tokens extracted from the reference HTML mocks in `src/ui/`.
 * Do not hand-pick colors in components; pull from here.
 */

/* ============================================================
 * Material 3 Palette
 * ========================================================== */
export const palette = {
  // Surfaces (navy/midnight)
  background: '#0c112e',
  surface: '#0c112e',
  surfaceDim: '#0c112e',
  surfaceBright: '#323756',
  surfaceContainerLowest: '#070b28',
  surfaceContainerLow: '#141936',
  surfaceContainer: '#191d3b',
  surfaceContainerHigh: '#232846',
  surfaceContainerHighest: '#2e3351',
  surfaceVariant: '#2e3351',
  surfaceTint: '#b0c6ff',

  // Foreground on surfaces
  onBackground: '#dee0ff',
  onSurface: '#dee0ff',
  onSurfaceVariant: '#c2c6d7',
  inverseSurface: '#dee0ff',
  inverseOnSurface: '#2a2e4c',

  // Primary (light blue)
  primary: '#b0c6ff',
  onPrimary: '#002d6e',
  primaryContainer: '#558dff',
  onPrimaryContainer: '#002661',
  primaryFixed: '#d9e2ff',
  primaryFixedDim: '#b0c6ff',
  onPrimaryFixed: '#001945',
  onPrimaryFixedVariant: '#00429b',
  inversePrimary: '#0058ca',

  // Secondary (lavender)
  secondary: '#bac3ff',
  onSecondary: '#15267b',
  secondaryContainer: '#2f3f92',
  onSecondaryContainer: '#a3b0ff',
  secondaryFixed: '#dee0ff',
  secondaryFixedDim: '#bac3ff',
  onSecondaryFixed: '#00105b',
  onSecondaryFixedVariant: '#2f3f92',

  // Tertiary (emerald — speaker/active indicator)
  tertiary: '#00e475',
  onTertiary: '#003918',
  tertiaryContainer: '#00a754',
  onTertiaryContainer: '#003114',
  tertiaryFixed: '#62ff96',
  tertiaryFixedDim: '#00e475',
  onTertiaryFixed: '#00210b',
  onTertiaryFixedVariant: '#005226',

  // Error
  error: '#ffb4ab',
  onError: '#690005',
  errorContainer: '#93000a',
  onErrorContainer: '#ffdad6',

  // Outline / borders
  outline: '#8c90a0',
  outlineVariant: '#424655',

  // Semantic accents used in mocks (not in M3 tokens)
  gold: '#ffd700',
  slate500: '#64748b',
  slateText: '#A0AEC0',

  // Static
  black: '#000000',
  white: '#FFFFFF',
  transparent: 'transparent',
} as const;

/* ============================================================
 * Semantic aliases — prefer these in components
 * ========================================================== */
export const colors = {
  // Surfaces
  background: palette.background,
  surface: palette.surface,
  surfaceAlt: palette.surfaceContainer,
  surfaceHigh: palette.surfaceContainerHigh,
  surfaceHighest: palette.surfaceContainerHighest,
  surfaceLow: palette.surfaceContainerLow,
  surfaceLowest: palette.surfaceContainerLowest,

  // Text
  text: palette.onSurface,
  textMuted: palette.onSurfaceVariant,
  textDim: palette.slateText,
  textInverse: palette.inverseOnSurface,

  // Brand
  primary: palette.primary,
  onPrimary: palette.onPrimary,
  primaryContainer: palette.primaryContainer,
  onPrimaryContainer: palette.onPrimaryContainer,

  secondary: palette.secondary,
  onSecondary: palette.onSecondary,

  accent: palette.tertiary,
  onAccent: palette.onTertiary,
  accentContainer: palette.tertiaryContainer,

  // Borders
  border: palette.outlineVariant,
  borderSoft: 'rgba(255,255,255,0.1)',
  outline: palette.outline,

  // Status
  success: palette.tertiary,
  warning: palette.gold,
  danger: palette.error,
  info: palette.primary,

  // Overlays
  overlay: 'rgba(7, 11, 40, 0.6)',
  glass: 'rgba(255, 255, 255, 0.05)',
  glassStrong: 'rgba(255, 255, 255, 0.08)',

  // White alpha ladder — used on gradient/hero backgrounds
  overlayWhite3: 'rgba(255, 255, 255, 0.03)',
  overlayWhite4: 'rgba(255, 255, 255, 0.04)',
  overlayWhite5: 'rgba(255, 255, 255, 0.05)',
  overlayWhite6: 'rgba(255, 255, 255, 0.06)',
  overlayWhite7: 'rgba(255, 255, 255, 0.07)',
  overlayWhite10: 'rgba(255, 255, 255, 0.10)',
  overlayWhite12: 'rgba(255, 255, 255, 0.12)',
  overlayWhite20: 'rgba(255, 255, 255, 0.20)',
  overlayWhite30: 'rgba(255, 255, 255, 0.30)',
  overlayWhite70: 'rgba(255, 255, 255, 0.70)',
  overlayWhite75: 'rgba(255, 255, 255, 0.75)',
  overlayWhite80: 'rgba(255, 255, 255, 0.80)',

  // Blue-ring overlay (avatar stacks)
  overlayBlue50: 'rgba(77, 163, 255, 0.50)',

  // Hero gradient (landing)
  gradientStart: '#1a3091',
  gradientMid: '#4d6dd1',
  gradientEnd: '#b0c6ff',

  // Semantic aliases used by legacy-style code
  textWhite: palette.white,
  backgroundDark: palette.background,

  // Static
  black: palette.black,
  white: palette.white,
  transparent: palette.transparent,
} as const;

/* ============================================================
 * Spacing (4pt grid)
 * ========================================================== */
export const spacing = {
  none: 0,
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  huge: 40,
  giant: 56,
  mega: 72,
} as const;

/* ============================================================
 * Radii — Material 3 shape scale + pills
 * ========================================================== */
export const radii = {
  none: 0,
  xs: 4, // DEFAULT in Tailwind config
  sm: 8, // lg in mocks
  md: 12, // xl in mocks
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  pill: 9999,
  circle: 9999,
} as const;

/* ============================================================
 * Typography
 * - Manrope for headlines/labels, Inter for body
 * - Load fonts at startup with expo-font
 * ========================================================== */
export const fontFamilies = {
  headlineBlack: 'Manrope-ExtraBold',
  headlineBold: 'Manrope-Bold',
  headline: 'Manrope-SemiBold',
  headlineRegular: 'Manrope-Regular',
  body: 'Inter-Regular',
  bodyMedium: 'Inter-Medium',
  bodySemibold: 'Inter-SemiBold',
  label: 'Inter-Medium',
  mono: 'Menlo',
} as const;

export const fontSizes = {
  xxs: 10,
  xs: 12,
  sm: 13,
  md: 14,
  lg: 16,
  xl: 18,
  xxl: 20,
  xxxl: 24,
  display: 28,
  hero: 32,
  huge: 40,
} as const;

export const fontWeights = {
  regular: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
  extrabold: '800',
  black: '900',
} as const;

export const lineHeights = {
  tight: 1.1,
  snug: 1.25,
  normal: 1.4,
  relaxed: 1.6,
} as const;

export const letterSpacing = {
  tighter: -0.8,
  tight: -0.4,
  normal: 0,
  wide: 0.3,
  wider: 1,
  widest: 2,
} as const;

export const typography = {
  hero: {
    fontFamily: fontFamilies.headlineBlack,
    fontSize: fontSizes.hero,
    lineHeight: fontSizes.hero * lineHeights.tight,
    letterSpacing: letterSpacing.tighter,
  },
  display: {
    fontFamily: fontFamilies.headlineBlack,
    fontSize: fontSizes.display,
    lineHeight: fontSizes.display * lineHeights.tight,
    letterSpacing: letterSpacing.tighter,
  },
  h1: {
    fontFamily: fontFamilies.headlineBlack,
    fontSize: fontSizes.xxxl,
    lineHeight: fontSizes.xxxl * lineHeights.snug,
    letterSpacing: letterSpacing.tight,
  },
  h2: {
    fontFamily: fontFamilies.headlineBold,
    fontSize: fontSizes.xxl,
    lineHeight: fontSizes.xxl * lineHeights.snug,
  },
  h3: {
    fontFamily: fontFamilies.headlineBold,
    fontSize: fontSizes.xl,
    lineHeight: fontSizes.xl * lineHeights.snug,
  },
  bodyLarge: {
    fontFamily: fontFamilies.body,
    fontSize: fontSizes.lg,
    lineHeight: fontSizes.lg * lineHeights.normal,
  },
  body: {
    fontFamily: fontFamilies.body,
    fontSize: fontSizes.md,
    lineHeight: fontSizes.md * lineHeights.normal,
  },
  bodyMedium: {
    fontFamily: fontFamilies.bodyMedium,
    fontSize: fontSizes.md,
    lineHeight: fontSizes.md * lineHeights.normal,
  },
  bodyBold: {
    fontFamily: fontFamilies.bodySemibold,
    fontSize: fontSizes.md,
    lineHeight: fontSizes.md * lineHeights.normal,
  },
  caption: {
    fontFamily: fontFamilies.body,
    fontSize: fontSizes.xs,
    lineHeight: fontSizes.xs * lineHeights.normal,
  },
  label: {
    fontFamily: fontFamilies.label,
    fontSize: fontSizes.sm,
    lineHeight: fontSizes.sm * lineHeights.normal,
    letterSpacing: letterSpacing.wide,
  },
  overline: {
    fontFamily: fontFamilies.headlineBold,
    fontSize: fontSizes.xxs,
    lineHeight: fontSizes.xxs * lineHeights.normal,
    textTransform: 'uppercase' as const,
    letterSpacing: letterSpacing.wider,
  },
  button: {
    fontFamily: fontFamilies.headlineBlack,
    fontSize: fontSizes.sm,
    lineHeight: fontSizes.sm * lineHeights.normal,
    letterSpacing: letterSpacing.normal,
  },
} as const;

/* ============================================================
 * Elevation / shadows — M3 dark uses soft glows, not drop-shadows
 * ========================================================== */
export const shadows = {
  none: {
    shadowColor: palette.transparent,
    shadowOpacity: 0,
    shadowRadius: 0,
    shadowOffset: { width: 0, height: 0 },
    elevation: 0,
  },
  sm: {
    shadowColor: palette.black,
    shadowOpacity: 0.2,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  md: {
    shadowColor: palette.black,
    shadowOpacity: 0.28,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 5,
  },
  lg: {
    shadowColor: palette.black,
    shadowOpacity: 0.4,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 10,
  },
  // Glow variants used by CTAs / speaker rings
  glowPrimary: {
    shadowColor: palette.primary,
    shadowOpacity: 0.4,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },
  glowAccent: {
    shadowColor: palette.tertiary,
    shadowOpacity: 0.5,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 0 },
    elevation: 8,
  },
} as const;

/* ============================================================
 * Motion / duration
 * ========================================================== */
export const durations = {
  instant: 100,
  fast: 180,
  normal: 240,
  slow: 360,
  slower: 520,
  pulse: 2000,
} as const;

export const easings = {
  standard: 'cubic-bezier(0.2, 0, 0, 1)',
  emphasized: 'cubic-bezier(0.3, 0, 0, 1)',
} as const;

/* ============================================================
 * z-index layering
 * ========================================================== */
export const zIndex = {
  base: 0,
  raised: 10,
  sticky: 50,
  overlay: 100,
  tabBar: 200,
  fab: 250,
  modal: 300,
  toast: 400,
  tooltip: 500,
} as const;

/* ============================================================
 * Layout constants
 * ========================================================== */
export const layout = {
  screenPaddingH: spacing.xxl,
  screenPaddingV: spacing.lg,
  tabBarHeight: 72, // floating bottom nav
  tabBarBottomOffset: 24,
  headerHeight: 64,
  avatarBorder: 2,
  fabSize: 64,
  maxContentWidth: 448, // max-w-md in the mocks
} as const;

/* ============================================================
 * Root theme export
 * ========================================================== */
export const theme = {
  colors,
  palette,
  spacing,
  radii,
  fontFamilies,
  fontSizes,
  fontWeights,
  lineHeights,
  letterSpacing,
  typography,
  shadows,
  durations,
  easings,
  zIndex,
  layout,
} as const;

export type Theme = typeof theme;
export type ThemeColors = typeof colors;
export type SpacingToken = keyof typeof spacing;
export type RadiusToken = keyof typeof radii;
export type TypographyVariant = keyof typeof typography;
