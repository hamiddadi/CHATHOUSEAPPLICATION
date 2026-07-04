/**
 * authStore.signOut — audit QA 2026-07-02 (SETTINGS / logout, Majeur x2):
 * the authenticated Socket.IO connection must be torn down and the
 * react-query cache purged, so the next account on this device can't inherit
 * the previous account's realtime events or see its cached data flash.
 */
import { queryClient } from '../../../core/providers/QueryProvider';
import { disconnectSocket } from '../../../shared/services/realtime/socketClient';
import type { AuthUser } from '../types/auth.types';
import { useAuthStore } from './authStore';

jest.mock('../services/authService', () => ({
  authService: {
    signOut: jest.fn().mockResolvedValue(undefined),
    getMe: jest.fn(),
  },
}));

jest.mock('../services/tokenStorage', () => ({
  tokenStorage: {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(undefined),
    clear: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('../../notifications/services/pushService', () => ({
  pushService: {
    unregisterCurrentDevice: jest.fn().mockResolvedValue(undefined),
    registerWithBackend: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('../../../shared/services/realtime/socketClient', () => ({
  disconnectSocket: jest.fn(),
  onReconnect: jest.fn(() => () => undefined),
}));

const user: AuthUser = {
  id: 'u1',
  username: 'tester',
  displayName: 'Tester',
  phoneNumber: '+10000000000',
  avatarUrl: null,
  bio: null,
  interests: [],
  hasCompletedOnboarding: true,
  createdAt: new Date(0).toISOString(),
};

describe('authStore.signOut', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    queryClient.clear();
    useAuthStore.setState({
      status: 'authenticated',
      isHydrating: false,
      user,
      session: {
        accessToken: 'access',
        refreshToken: 'refresh',
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      },
      error: null,
    });
  });

  it('disconnects the realtime socket', async () => {
    await useAuthStore.getState().signOut();
    expect(disconnectSocket).toHaveBeenCalledTimes(1);
  });

  it('purges the react-query cache so the next account sees no stale data', async () => {
    queryClient.setQueryData(['messages', 'unread'], 3);
    queryClient.setQueryData(['notifications', 'list', 'all'], [{ id: 'n1' }]);
    expect(queryClient.getQueryCache().getAll().length).toBe(2);

    await useAuthStore.getState().signOut();

    expect(queryClient.getQueryData(['messages', 'unread'])).toBeUndefined();
    expect(queryClient.getQueryData(['notifications', 'list', 'all'])).toBeUndefined();
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
  });

  it('resets the auth state to unauthenticated', async () => {
    await useAuthStore.getState().signOut();
    const state = useAuthStore.getState();
    expect(state.status).toBe('unauthenticated');
    expect(state.user).toBeNull();
    expect(state.session).toBeNull();
  });
});
