import { create } from 'zustand';
import { authService } from '../services/authService';
import { tokenStorage } from '../services/tokenStorage';
import { pushService } from '../../notifications/services/pushService';
import type { AuthSession, AuthStatus, AuthUser } from '../types/auth.types';

interface AuthState {
  status: AuthStatus;
  isHydrating: boolean;
  user: AuthUser | null;
  session: AuthSession | null;
  error: string | null;

  hydrate: () => Promise<void>;
  refreshMe: () => Promise<void>;
  requestOtp: (phoneNumber: string) => Promise<void>;
  verifyOtp: (phoneNumber: string, code: string) => Promise<{ isNewUser: boolean }>;
  devLogin: () => Promise<{ isNewUser: boolean }>;
  setUsername: (username: string) => Promise<void>;
  completeOnboarding: (input: {
    displayName?: string;
    bio?: string;
    avatarUrl?: string | null;
    interests?: string[];
  }) => Promise<void>;
  signOut: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, _get) => ({
  status: 'idle',
  isHydrating: true,
  user: null,
  session: null,
  error: null,

  hydrate: async () => {
    try {
      const session = await tokenStorage.get();
      if (!session) {
        set({ session: null, status: 'unauthenticated', isHydrating: false });
        return;
      }
      // Re-read the user from the API so we know their onboarding flag
      // after a restart. If the call fails, fall back to the cached token
      // and let the router treat the user as authenticated but unfetched;
      // screens can retry via refreshMe.
      try {
        const user = await authService.getMe();
        set({ session, user, status: 'authenticated', isHydrating: false });
      } catch (e) {
        const err = e as { kind?: string };
        // A 401 here already ran the interceptor's onUnauthenticated → signOut
        // (token cleared, status flipped to 'unauthenticated'). Seeing kind==='auth'
        // OR a live status already 'unauthenticated' means the session is dead —
        // do NOT revive it with the stale local `session`. A transient
        // (network/server) failure is tolerated by keeping the cached token.
        // (Check status, not session: the store's `session` is never populated
        // before this point, so it's null on transient failures too.)
        if (err?.kind === 'auth' || _get().status === 'unauthenticated') {
          set({ session: null, user: null, status: 'unauthenticated', isHydrating: false });
          return;
        }
        set({ session, status: 'authenticated', isHydrating: false });
      }
      // Best-effort push registration after cold start too. The backend
      // dedupes on token so a re-register after every launch is fine.
      void pushService.registerWithBackend();
    } catch {
      set({ status: 'unauthenticated', isHydrating: false });
    }
  },

  refreshMe: async () => {
    try {
      const user = await authService.getMe();
      set({ user });
    } catch {
      // Silent — callers can show a toast if needed.
    }
  },

  requestOtp: async phoneNumber => {
    set({ status: 'authenticating', error: null });
    try {
      await authService.requestOtp(phoneNumber);
      set({ status: 'unauthenticated' });
    } catch (e) {
      set({ status: 'unauthenticated', error: (e as Error).message });
      throw e;
    }
  },

  verifyOtp: async (phoneNumber, code) => {
    set({ status: 'authenticating', error: null });
    try {
      const { session, user, isNewUser } = await authService.verifyOtp(phoneNumber, code);
      await tokenStorage.set(session);
      if (isNewUser) {
        // Stay 'authenticating' (isAuthenticated=false) so the Auth stack stays
        // mounted and OtpScreen can navigate to the Username step. Promoting to
        // 'authenticated' here would unmount Auth and make Username unreachable.
        // setUsername() completes the promotion.
        set({ session, user, status: 'authenticating' });
        return { isNewUser };
      }
      set({ session, user, status: 'authenticated' });
      // Fire-and-forget: request a push token + register with the backend.
      // No-op in test/web environments without expo-notifications.
      void pushService.registerWithBackend();
      return { isNewUser };
    } catch (e) {
      set({ status: 'unauthenticated', error: (e as Error).message });
      throw e;
    }
  },

  devLogin: async () => {
    set({ status: 'authenticating', error: null });
    try {
      const { session, user, isNewUser } = await authService.devLogin();
      await tokenStorage.set(session);
      set({ session, user, status: 'authenticated' });
      void pushService.registerWithBackend();
      return { isNewUser };
    } catch (e) {
      set({ status: 'unauthenticated', error: (e as Error).message });
      throw e;
    }
  },

  setUsername: async username => {
    const { user } = await authService.setUsername(username);
    // Promote to 'authenticated' now that the new user has a handle — this is
    // what swaps the Auth stack for Onboarding/Main (verifyOtp left a new user
    // in 'authenticating' precisely so Username could be reached first).
    set({ user, status: 'authenticated' });
    void pushService.registerWithBackend();
  },

  completeOnboarding: async input => {
    const { user } = await authService.completeOnboarding(input);
    set({ user });
  },

  signOut: async () => {
    // Drop the push token BEFORE invalidating the session so the
    // /push/unregister call still carries a valid Authorization header.
    await pushService.unregisterCurrentDevice();
    // Tear down the Agora engine — the singleton holds a native session,
    // a worker thread and an in-flight RTC channel join. Without an
    // explicit release, those leak across logouts and the next login
    // would inherit a stale audio bus. The require is dynamic to keep
    // this file booting in test envs without `react-native-agora`.
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { releaseAgora } = require('../../rooms/services/agora/AgoraEngine') as {
        releaseAgora: () => void;
      };
      releaseAgora();
    } catch {
      /* engine wasn't loaded (Expo Go / unit test) — nothing to release */
    }
    await authService.signOut();
    await tokenStorage.clear();
    set({ user: null, session: null, status: 'unauthenticated' });
  },
}));
