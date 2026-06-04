import { darkTheme, type Theme } from './dark';
import { lightTheme } from './light';

export { darkTheme, lightTheme };
export type { Theme };

/**
 * Convenience selector for the new ExtThemeProvider (Vague 2).
 * Legacy code keeps importing from `src/shared/constants/theme.ts`
 * directly — that path is unchanged.
 */
export const themeFor = (scheme: 'light' | 'dark'): Theme =>
  scheme === 'dark' ? darkTheme : lightTheme;
