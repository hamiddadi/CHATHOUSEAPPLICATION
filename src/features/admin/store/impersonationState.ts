import { create } from 'zustand';

/**
 * Impersonation state — split from `impersonationStore.ts` to break the
 * require cycle:
 *   apiClient.ts → interceptors.ts → impersonationStore.ts →
 *   adminService.ts → apiClient.ts
 *
 * This module has ZERO transitive deps on `apiClient`. The interceptor
 * imports `getImpersonationToken` from here only, so the cycle is gone.
 * The `start`/`stop` mutations live in `impersonationStore.ts` (which is
 * allowed to depend on adminService — it's only imported from React UI).
 */
export interface ImpersonatedUser {
  id: string;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
}

interface State {
  token: string | null;
  user: ImpersonatedUser | null;
  expiresAt: number | null;

  /** Internal — set by `impersonationStore.start()`. */
  setSession: (token: string, user: ImpersonatedUser, expiresInSec: number) => void;
  /** Internal — clear() drops the session locally; the network audit ping
   *  lives in `impersonationStore.stop()`. */
  clear: () => void;
}

export const useImpersonationState = create<State>(set => ({
  token: null,
  user: null,
  expiresAt: null,

  setSession: (token, user, expiresInSec) =>
    set({ token, user, expiresAt: Date.now() + expiresInSec * 1000 }),

  clear: () => set({ token: null, user: null, expiresAt: null }),
}));

/**
 * Bridges the Zustand store with the axios request interceptor (which
 * lives outside React). Returning an active token tells the interceptor
 * to swap it in for the super-admin's bearer.
 */
export const getImpersonationToken = (): string | null => {
  const s = useImpersonationState.getState();
  if (s.token && s.expiresAt && s.expiresAt > Date.now()) return s.token;
  if (s.token && s.expiresAt && s.expiresAt <= Date.now()) {
    // Auto-clear expired session so subsequent reads are honest.
    s.clear();
  }
  return null;
};
