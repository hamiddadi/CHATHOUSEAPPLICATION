import React, { createContext, useContext, type ReactNode } from 'react';
import { useExtBackend, type ExtBackendStatus } from '../hooks/useExtBackend';
import { useExtPresenceHeartbeat } from '../hooks/useExtPresenceHeartbeat';
import { useExtPushToken } from '../hooks/useExtPushToken';
import { ExtThemeProvider, type ExtThemeMode } from './ExtThemeProvider';

/**
 * Unified provider that wires every always-on extension subsystem into the
 * app at one root point. Mount once at the top of the navigator tree :
 *
 * ```tsx
 * <ExtensionsProvider>
 *   <ExistingApp />
 * </ExtensionsProvider>
 * ```
 *
 * Bundles :
 *   - `ExtThemeProvider`            (V2 — dark/light/auto)
 *   - `useExtBackend()` probe       (V17 — gates extension UI)
 *   - `useExtPresenceHeartbeat()`   (V11 — keep online status fresh)
 *   - `useExtPushToken()` (gated)   (V12 — register push token after auth)
 *
 * Children read the backend status via `useExtensions()`.
 */

interface ExtensionsContextValue {
  backend: ExtBackendStatus;
  backendLoading: boolean;
}

const ExtensionsContext = createContext<ExtensionsContextValue | null>(null);

interface ExtensionsProviderProps {
  children: ReactNode;
  /** Whether the user is currently authenticated; gates push-token registration. */
  authenticated?: boolean;
  /** Override the initial theme (defaults to 'auto'). */
  initialThemeMode?: ExtThemeMode;
  /** Disable the presence heartbeat (e.g. during tests). */
  presenceEnabled?: boolean;
}

const Inner: React.FC<{
  children: ReactNode;
  authenticated: boolean;
  presenceEnabled: boolean;
}> = ({ children, authenticated, presenceEnabled }) => {
  const { status, loading } = useExtBackend();

  useExtPresenceHeartbeat(presenceEnabled && authenticated);
  useExtPushToken(authenticated && status.available);

  return (
    <ExtensionsContext.Provider value={{ backend: status, backendLoading: loading }}>
      {children}
    </ExtensionsContext.Provider>
  );
};

export const ExtensionsProvider: React.FC<ExtensionsProviderProps> = ({
  children,
  authenticated = false,
  initialThemeMode = 'auto',
  presenceEnabled = true,
}) => (
  <ExtThemeProvider initialMode={initialThemeMode}>
    <Inner authenticated={authenticated} presenceEnabled={presenceEnabled}>
      {children}
    </Inner>
  </ExtThemeProvider>
);

/**
 * Read the backend probe status from anywhere under `<ExtensionsProvider>`.
 * When the provider is absent, returns a safe default (everything off).
 */
export const useExtensions = (): ExtensionsContextValue => {
  const ctx = useContext(ExtensionsContext);
  return (
    ctx ?? {
      backend: {
        available: false,
        vaguesMounted: [],
        features: { payments: false, captions: false, twitter: false, contacts: false },
      },
      backendLoading: false,
    }
  );
};
