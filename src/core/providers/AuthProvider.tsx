import React, { useEffect } from 'react';
import { useAuthStore } from '../../features/auth/store/authStore';
import { useGhostModeStore } from '../../features/maps/store/ghostModeStore';
import { initApiClient } from '../../shared/services/api';

/**
 * - Wires auth-aware axios interceptors (once).
 * - Hydrates persisted auth state + ghost mode preference on app start.
 */
export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const hydrateAuth = useAuthStore(s => s.hydrate);
  const signOut = useAuthStore(s => s.signOut);
  const refreshMe = useAuthStore(s => s.refreshMe);
  const status = useAuthStore(s => s.status);
  const hasUser = useAuthStore(s => s.user !== null);
  const hydrateGhost = useGhostModeStore(s => s.hydrate);

  useEffect(() => {
    initApiClient({
      onUnauthenticated: async () => {
        await signOut();
      },
    });
    void hydrateAuth();
    void hydrateGhost();
  }, [hydrateAuth, hydrateGhost, signOut]);

  // Self-heal an "authenticated but no user" state: hydrate() intentionally
  // keeps the cached session (status='authenticated') when the cold-start
  // getMe fails transiently (network flap), expecting refreshMe to fill in the
  // profile — but nothing else triggers it. Left unfetched, `viewerId` stays
  // null and every user-dependent branch breaks (host detection, "me" in the
  // participant lists, mute-state hydration…). Retry a few times until the
  // profile lands.
  useEffect(() => {
    if (status !== 'authenticated' || hasUser) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    let attempts = 0;
    const attempt = async (): Promise<void> => {
      await refreshMe();
      if (cancelled) return;
      if (useAuthStore.getState().user === null && attempts++ < 5) {
        timer = setTimeout(() => void attempt(), 2000);
      }
    };
    void attempt();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [status, hasUser, refreshMe]);

  return <>{children}</>;
};
