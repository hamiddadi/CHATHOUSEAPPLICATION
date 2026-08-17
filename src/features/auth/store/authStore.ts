import { create } from 'zustand';
import { authService } from '../services/authService';
import { tokenStorage } from '../services/tokenStorage';
import { pushService } from '../../notifications/services/pushService';
import { useOnboardingStore } from '../../onboarding/store/onboardingStore';
import { useInviteStore } from '../../extensions/store/inviteStore';
import { useCurrentRoomStore } from '../../rooms/store/currentRoomStore';
import { useImpersonationState } from '../../admin/store/impersonationState';
import { disconnectSocket } from '../../../shared/services/realtime/socketClient';
import { queryClient } from '../../../core/providers/QueryProvider';
import { privacyService } from '../../privacy/services/privacyService';
import { reportException } from '../../../core/observability/reporter';
import type {
  AuthSession,
  AuthStatus,
  AuthUser,
  LegalAcceptancePayload,
} from '../types/auth.types';

interface AuthState {
  status: AuthStatus;
  isHydrating: boolean;
  user: AuthUser | null;
  session: AuthSession | null;
  error: string | null;

  hydrate: () => Promise<void>;
  refreshMe: () => Promise<void>;
  requestOtp: (phoneNumber: string, legal: LegalAcceptancePayload) => Promise<void>;
  verifyOtp: (
    phoneNumber: string,
    code: string,
    legal: LegalAcceptancePayload,
  ) => Promise<{ isNewUser: boolean }>;
  acceptLegalDocuments: (legal: LegalAcceptancePayload) => Promise<void>;
  devLogin: () => Promise<{ isNewUser: boolean }>;
  setUsername: (username: string) => Promise<void>;
  completeOnboarding: (input: {
    displayName?: string;
    firstName?: string;
    lastName?: string;
    bio?: string;
    avatarUrl?: string | null;
    interests?: string[];
  }) => Promise<void>;
  restoreAccount: () => Promise<void>;
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
        set({
          session,
          user,
          status:
            user.accountState === 'PENDING_DELETION' ? 'restoration_required' : 'authenticated',
          isHydrating: false,
        });
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
        set({
          session,
          status: session.scope === 'account_recovery' ? 'restoration_required' : 'authenticated',
          isHydrating: false,
        });
      }
      // Best-effort push registration after cold start too. The backend
      // dedupes on token so a re-register after every launch is fine.
      if (_get().status === 'authenticated') void pushService.registerWithBackend();
    } catch {
      set({ status: 'unauthenticated', isHydrating: false });
    }
  },

  refreshMe: async () => {
    try {
      const user = await authService.getMe();
      set({
        user,
        status: user.accountState === 'PENDING_DELETION' ? 'restoration_required' : 'authenticated',
      });
    } catch {
      // Silent — callers can show a toast if needed.
    }
  },

  requestOtp: async (phoneNumber, legal) => {
    set({ status: 'authenticating', error: null });
    try {
      await authService.requestOtp(phoneNumber, legal);
      set({ status: 'unauthenticated' });
    } catch (e) {
      set({ status: 'unauthenticated', error: (e as Error).message });
      throw e;
    }
  },

  verifyOtp: async (phoneNumber, code, legal) => {
    set({ status: 'authenticating', error: null });
    try {
      const { session, user, isNewUser } = await authService.verifyOtp(phoneNumber, code, legal);
      await tokenStorage.set(session);
      if (user.accountState === 'PENDING_DELETION') {
        set({ session, user, status: 'restoration_required' });
        return { isNewUser: false };
      }
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

  acceptLegalDocuments: async legal => {
    const accepted = await authService.acceptLegalDocuments(legal);
    set(state => ({
      user: state.user ? { ...state.user, ...accepted } : state.user,
    }));
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

  restoreAccount: async () => {
    const { session, user } = await privacyService.cancelDeletion();
    // The backend restoration and active credential rotation have already
    // committed. Promote the in-memory boundary first so a Keychain failure
    // cannot leave the UI holding an invalid recovery bearer with no retry.
    set({ session, user, status: 'authenticated', error: null });
    try {
      await tokenStorage.set(session);
    } catch (err) {
      reportException(err, { operation: 'persist-restored-auth-session' });
      // tokenStorage has already installed the active process-local session,
      // so API/socket consumers keep using the rotated bearer. On a restart,
      // any older persisted recovery token is rejected by the backend and the
      // normal auth teardown asks the now-active account to sign in again.
    }
    void pushService.registerWithBackend();
  },

  signOut: async () => {
    // Drop the push token BEFORE invalidating the session so the
    // /push/unregister call still carries a valid Authorization header.
    await pushService.unregisterCurrentDevice().catch(err => {
      reportException(err, { operation: 'sign-out-unregister-push' });
    });
    // Tear down the LiveKit engine — release any active room connections,
    // native resources, and in-flight reconnection timers. Without an
    // explicit release, those leak across logouts and the next login
    // would inherit a stale audio bus. The require is dynamic to keep
    // this file booting in test envs without `@livekit/react-native`.
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { releaseLiveKit } = require('../../rooms/services/livekit/LiveKitEngine') as {
        releaseLiveKit: () => void;
      };
      releaseLiveKit();
    } catch {
      /* engine wasn't loaded (Expo Go / unit test) — nothing to release */
    }
    await authService.signOut().catch(err => {
      reportException(err, { operation: 'sign-out-revoke-server-session' });
    });
    await tokenStorage.clear().catch(err => {
      // tokenStorage tombstones the process-local session before touching the
      // native Keychain, so even a persistence failure cannot resurrect the
      // bearer in this process.
      reportException(err, { operation: 'sign-out-clear-persisted-session' });
    });
    // Tear down the authenticated realtime connection: without this the
    // Socket.IO singleton (whose handshake carried the old token) survives
    // the sign-out and keeps receiving events for the previous account.
    try {
      disconnectSocket();
    } catch (err) {
      reportException(err, { operation: 'sign-out-disconnect-socket' });
    }
    // Flip the router before optional cache/store cleanup; no cleanup failure
    // may leave the user on an authenticated surface with a revoked bearer.
    set({ user: null, session: null, status: 'unauthenticated' });
    // Purge the react-query cache so the next account on this device never
    // sees the previous account's data flash while its own queries load.
    try {
      queryClient.clear();
    } catch (err) {
      reportException(err, { operation: 'sign-out-clear-query-cache' });
    }
    // Reset cross-session stores so the next user on this device can't inherit
    // the previous user's state: an onboarding draft (name/interests/avatar), a
    // pending invite code, the current-room mini-bar, or an active admin
    // impersonation. GhostMode is a per-device preference, so it's left intact.
    const resets: Array<[string, () => void]> = [
      ['onboarding', () => useOnboardingStore.getState().reset()],
      ['invite', () => useInviteStore.getState().clear()],
      ['current-room', () => useCurrentRoomStore.getState().clear()],
      ['impersonation', () => useImpersonationState.getState().clear()],
    ];
    for (const [store, reset] of resets) {
      try {
        reset();
      } catch (err) {
        reportException(err, { operation: 'sign-out-reset-store', store });
      }
    }
  },
}));
