import { create } from 'zustand';
import { authService } from '../services/authService';
import { tokenStorage } from '../services/tokenStorage';
import type { AuthSession, AuthStatus, AuthUser } from '../types/auth.types';

interface AuthState {
  status: AuthStatus;
  isHydrating: boolean;
  user: AuthUser | null;
  session: AuthSession | null;
  error: string | null;

  hydrate: () => Promise<void>;
  requestOtp: (phoneNumber: string) => Promise<void>;
  verifyOtp: (phoneNumber: string, code: string) => Promise<{ isNewUser: boolean }>;
  setUsername: (username: string) => Promise<void>;
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
      set({
        session,
        status: session ? 'authenticated' : 'unauthenticated',
        isHydrating: false,
      });
    } catch {
      set({ status: 'unauthenticated', isHydrating: false });
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
      set({ session, user, status: 'authenticated' });
      return { isNewUser };
    } catch (e) {
      set({ status: 'unauthenticated', error: (e as Error).message });
      throw e;
    }
  },

  setUsername: async username => {
    const { user } = await authService.setUsername(username);
    set({ user });
  },

  signOut: async () => {
    await authService.signOut();
    await tokenStorage.clear();
    set({ user: null, session: null, status: 'unauthenticated' });
  },
}));
