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

  return <>{children}</>;
};
