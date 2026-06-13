/**
 * App fonts (Manrope + Inter weights) are bundled natively in
 * `android/app/src/main/assets/fonts/` (de-Expo migration: was `expo-font`
 * `useFonts` + `@expo-google-fonts`). Native fonts are available by family name
 * at process start, so there is no async load step — this hook reports ready
 * immediately. The `.ttf` filenames (Manrope-Regular, Inter-Bold, …) ARE the
 * Android font-family names and MUST match `fontFamilies` in
 * `shared/constants/theme.ts`.
 */
export const useAppFonts = (): { loaded: boolean; error: Error | null } => {
  return { loaded: true, error: null };
};
