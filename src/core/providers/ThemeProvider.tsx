import React, { createContext, useContext, useMemo } from 'react';
import { theme as defaultTheme, type Theme } from '../../shared/constants/theme';

type ThemeMode = 'light';

interface ThemeContextValue {
  theme: Theme;
  mode: ThemeMode;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const value = useMemo<ThemeContextValue>(() => ({ theme: defaultTheme, mode: 'light' }), []);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};

export const useTheme = (): ThemeContextValue => {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
};
