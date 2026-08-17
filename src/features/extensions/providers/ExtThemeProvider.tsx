import React, { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import type { ColorSchemeName } from 'react-native';

/**
 * Compatibility context for extension modules.
 *
 * ChatHouse currently ships one dark token set. Reporting an OS-dependent
 * light scheme here while every consumer stayed dark was misleading. The
 * legacy mode union remains for API compatibility, but the effective scheme
 * is truthfully dark until a complete variable-token light theme exists.
 */

export type ExtThemeMode = 'auto' | 'light' | 'dark';
export type EffectiveColorScheme = 'light' | 'dark';

interface ExtThemeContextValue {
  mode: ExtThemeMode;
  setMode: (mode: ExtThemeMode) => void;
  effective: EffectiveColorScheme;
  systemScheme: ColorSchemeName;
}

const ExtThemeContext = createContext<ExtThemeContextValue | null>(null);

interface ExtThemeProviderProps {
  children: ReactNode;
  /** Legacy test/config input. Ignored while the product is mono-dark. */
  initialMode?: ExtThemeMode;
}

export const ExtThemeProvider: React.FC<ExtThemeProviderProps> = ({ children }) => {
  const setMode = useCallback((_requestedMode: ExtThemeMode) => undefined, []);
  const value = useMemo<ExtThemeContextValue>(
    () => ({ mode: 'dark', setMode, effective: 'dark', systemScheme: 'dark' }),
    [setMode],
  );

  return <ExtThemeContext.Provider value={value}>{children}</ExtThemeContext.Provider>;
};

export const useExtThemeMode = (): ExtThemeContextValue => {
  const ctx = useContext(ExtThemeContext);
  if (ctx) return ctx;

  return {
    mode: 'dark',
    setMode: () => undefined,
    effective: 'dark',
    systemScheme: 'dark',
  };
};

/** Return the only color scheme currently backed by application tokens. */
export const useExtColorScheme = (): EffectiveColorScheme => useExtThemeMode().effective;
