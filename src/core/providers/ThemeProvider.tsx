import React, { createContext, useContext, useMemo } from 'react';
import { theme as defaultTheme, type Theme } from '../../shared/constants/theme';

// Chathouse ships a single, intentionally dark theme (the navy palette in
// constants/theme.ts). `mode` is reported truthfully as 'dark' so consumers
// (e.g. StatusBar style, useColorScheme-aware components) don't have to guess.
// A dynamic light/dark switch would require deriving `colors` from context in
// every screen — out of scope for the current single-theme product.
type ThemeMode = 'dark';

interface ThemeContextValue {
  theme: Theme;
  mode: ThemeMode;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const value = useMemo<ThemeContextValue>(() => ({ theme: defaultTheme, mode: 'dark' }), []);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};

export const useTheme = (): ThemeContextValue => {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
};
