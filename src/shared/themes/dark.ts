/**
 * Dark theme — re-export of the existing dark palette in
 * `src/shared/constants/theme.ts`. Provides a stable surface for the new
 * Vague 2 ExtThemeProvider without modifying the legacy file.
 */
import {
  colors as legacyColors,
  palette as legacyPalette,
  spacing,
  radii,
  fontFamilies,
  fontSizes,
  fontWeights,
  lineHeights,
  letterSpacing,
} from '../constants/theme';
import type { Theme } from './theme.types';

export const darkTheme = {
  mode: 'dark' as const,
  palette: legacyPalette,
  colors: legacyColors,
  spacing,
  radii,
  fontFamilies,
  fontSizes,
  fontWeights,
  lineHeights,
  letterSpacing,
} as const satisfies Theme;

export type { Theme };
