import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { Appearance, type ColorSchemeName } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Dark mode override layer that sits *above* the existing ThemeProvider.
 *
 * The existing `ThemeProvider` (src/core/providers/ThemeProvider.tsx)
 * hardcodes `mode='light'` and cannot be modified per the extension
 * contract. This wrapper exposes a complementary context that consumers
 * read via `useExtThemeMode()` to decide whether to render dark variants.
 *
 * Modes:
 *   - 'auto'  : follows OS color scheme (default)
 *   - 'light' : forced light
 *   - 'dark'  : forced dark
 */

export type ExtThemeMode = 'auto' | 'light' | 'dark';
export type EffectiveColorScheme = 'light' | 'dark';

interface ExtThemeContextValue {
  mode: ExtThemeMode;
  setMode: (m: ExtThemeMode) => void;
  effective: EffectiveColorScheme;
  systemScheme: ColorSchemeName;
}

const ExtThemeContext = createContext<ExtThemeContextValue | null>(null);

const STORAGE_KEY = 'ext.theme.mode';

// AsyncStorage is a direct project dependency, so import it statically: a
// dynamic `import('...' as string)` is opaque to Metro and silently no-ops in
// production EAS builds, leaving the preference unpersisted. The get/set calls
// below stay wrapped in try/catch so a storage failure never crashes the UI.
const readStoredMode = async (): Promise<string | null> => {
  try {
    return await AsyncStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
};

const writeStoredMode = async (mode: ExtThemeMode): Promise<void> => {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, mode);
  } catch {
    /* ignore — preference persistence is best-effort */
  }
};

interface ExtThemeProviderProps {
  children: ReactNode;
  /** Initial mode override (used in tests). */
  initialMode?: ExtThemeMode;
}

export const ExtThemeProvider: React.FC<ExtThemeProviderProps> = ({
  children,
  initialMode = 'auto',
}) => {
  const [mode, setModeState] = useState<ExtThemeMode>(initialMode);
  const [systemScheme, setSystemScheme] = useState<ColorSchemeName>(
    Appearance.getColorScheme() ?? 'light',
  );

  // Hydrate the persisted preference once.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const saved = await readStoredMode();
      if (!cancelled && (saved === 'auto' || saved === 'light' || saved === 'dark')) {
        setModeState(saved);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Subscribe to OS color-scheme changes
  useEffect(() => {
    const sub = Appearance.addChangeListener(({ colorScheme }) => {
      setSystemScheme(colorScheme);
    });
    return () => sub.remove();
  }, []);

  const setMode = useCallback((m: ExtThemeMode) => {
    setModeState(m);
    void writeStoredMode(m);
  }, []);

  const effective: EffectiveColorScheme = useMemo(() => {
    if (mode === 'light') return 'light';
    if (mode === 'dark') return 'dark';
    return systemScheme === 'dark' ? 'dark' : 'light';
  }, [mode, systemScheme]);

  const value = useMemo<ExtThemeContextValue>(
    () => ({ mode, setMode, effective, systemScheme }),
    [mode, setMode, effective, systemScheme],
  );

  return <ExtThemeContext.Provider value={value}>{children}</ExtThemeContext.Provider>;
};

export const useExtThemeMode = (): ExtThemeContextValue => {
  const ctx = useContext(ExtThemeContext);
  if (!ctx) {
    // Soft fallback when the provider isn't mounted — return safe defaults.
    return {
      mode: 'auto',
      setMode: () => undefined,
      effective: 'light',
      systemScheme: 'light',
    };
  }
  return ctx;
};

/**
 * Convenience hook returning the effective scheme directly. Useful when the
 * consumer only cares about light vs dark and not the mode setting.
 */
export const useExtColorScheme = (): EffectiveColorScheme => useExtThemeMode().effective;
