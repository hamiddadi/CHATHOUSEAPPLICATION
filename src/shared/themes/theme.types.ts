/**
 * Mode-agnostic `Theme` shape shared by {@link darkTheme} and
 * {@link lightTheme}.
 *
 * Previously `Theme` was `typeof darkTheme`, which baked the *dark* literal
 * values (`mode: 'dark'`, `background: '#0c112e'`, …) into the type. The light
 * theme therefore did not satisfy it structurally, and `index.ts` papered over
 * the mismatch with an `as Theme` cast — silently disabling the structural
 * check.
 *
 * Here we derive the shape from the legacy design tokens in
 * `src/shared/constants/theme.ts` (the single source of truth for which token
 * groups exist and how the typography/spacing scales are typed) but *relax* the
 * three groups that legitimately differ between modes:
 *
 *   - `mode`               → the `'light' | 'dark'` union instead of a literal
 *   - `palette` / `colors` → their color values widened from string literals
 *                            to `string`, so any concrete hex/rgba value fits
 *
 * The remaining token groups (`spacing`, `radii`, `fontFamilies`, …) are the
 * exact same imported constants in both themes, so their `as const` types are
 * already identical and are carried through unchanged.
 *
 * Deriving from the constants module (rather than from `typeof darkTheme`)
 * keeps the type acyclic, so `darkTheme` can be checked against it with
 * `satisfies Theme` without a circular reference.
 *
 * The result is a structural contract that BOTH themes satisfy without a cast.
 * Type-only — no runtime impact.
 */
import type {
  palette,
  colors,
  spacing,
  radii,
  fontFamilies,
  fontSizes,
  fontWeights,
  lineHeights,
  letterSpacing,
} from '../constants/theme';

/** Widen every string-literal leaf of a token map to `string`. */
type WidenColorValues<T> = {
  [K in keyof T]: T[K] extends string ? string : T[K];
};

export type Theme = {
  mode: 'light' | 'dark';
  palette: WidenColorValues<typeof palette>;
  colors: WidenColorValues<typeof colors>;
  spacing: typeof spacing;
  radii: typeof radii;
  fontFamilies: typeof fontFamilies;
  fontSizes: typeof fontSizes;
  fontWeights: typeof fontWeights;
  lineHeights: typeof lineHeights;
  letterSpacing: typeof letterSpacing;
};
