/**
 * authStore.signOut — audit QA 2026-07-02 (SETTINGS / logout, Majeur x2):
 * the authenticated Socket.IO connection must be torn down and the
 * react-query cache purged, so the next account on this device can't inherit
 * the previous account's realtime events or see its cached data flash.
 */
import { queryClient } from '../../../core/providers/QueryProvider';
import { reportException } from '../../../core/observability/reporter';
import { disconnectSocket } from '../../../shared/services/realtime/socketClient';
import { pushService } from '../../notifications/services/pushService';
import { privacyService } from '../../privacy/services/privacyService';
import { authService } from '../services/authService';
import { tokenStorage } from '../services/tokenStorage';
import type { AuthSession, AuthUser } from '../types/auth.types';
import { useAuthStore } from './authStore';

jest.mock('../services/authService', () => ({
  authService: {
    signOut: jest.fn().mockResolvedValue(undefined),
    getMe: jest.fn(),
  },
}));

jest.mock('../../../core/observability/reporter', () => ({
  reportException: jest.fn(),
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

jest.mock('../../privacy/services/privacyService', () => ({
  privacyService: {
    cancelDeletion: jest.fn(),
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
  accountState: 'ACTIVE',
  deletedAt: null,
  permanentDeletionAt: null,
  createdAt: new Date(0).toISOString(),
};

const activeSession: AuthSession = {
  accessToken: 'active-access',
  refreshToken: 'active-refresh',
  expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  scope: 'active',
};

const recoverySession: AuthSession = {
  accessToken: 'recovery-access',
  refreshToken: 'recovery-refresh',
  expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  scope: 'account_recovery',
};

const pendingUser: AuthUser = {
  ...user,
  accountState: 'PENDING_DELETION',
  deletedAt: new Date().toISOString(),
  permanentDeletionAt: new Date(Date.now() + 30 * 24 * 60 * 60_000).toISOString(),
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
        ...activeSession,
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

  it('finishes recovery sign-out when persisted-session deletion fails', async () => {
    useAuthStore.setState({
      status: 'restoration_required',
      user: pendingUser,
      session: recoverySession,
    });
    jest.mocked(tokenStorage.clear).mockRejectedValueOnce(new Error('Keychain reset unavailable'));
    queryClient.setQueryData(['private', 'recovery'], { secret: true });

    await expect(useAuthStore.getState().signOut()).resolves.toBeUndefined();

    expect(disconnectSocket).toHaveBeenCalledTimes(1);
    expect(useAuthStore.getState()).toMatchObject({
      status: 'unauthenticated',
      user: null,
      session: null,
    });
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
    expect(reportException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ operation: 'sign-out-clear-persisted-session' }),
    );
  });
});

describe('authStore account recovery', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useAuthStore.setState({
      status: 'restoration_required',
      isHydrating: false,
      user: pendingUser,
      session: recoverySession,
      error: null,
    });
  });

  it('hydrates a recovery session without registering push access', async () => {
    jest.mocked(tokenStorage.get).mockResolvedValueOnce(recoverySession);
    jest.mocked(authService.getMe).mockResolvedValueOnce(pendingUser);

    await useAuthStore.getState().hydrate();

    expect(useAuthStore.getState()).toMatchObject({
      status: 'restoration_required',
      user: pendingUser,
      session: recoverySession,
    });
    expect(pushService.registerWithBackend).not.toHaveBeenCalled();
  });

  it('keeps a recovery session actionable when the cold-start profile read is unavailable', async () => {
    useAuthStore.setState({ user: null, status: 'idle', session: null, isHydrating: true });
    jest.mocked(tokenStorage.get).mockResolvedValueOnce(recoverySession);
    jest.mocked(authService.getMe).mockRejectedValueOnce(new Error('network unavailable'));

    await useAuthStore.getState().hydrate();

    expect(useAuthStore.getState()).toMatchObject({
      status: 'restoration_required',
      user: null,
      session: recoverySession,
      isHydrating: false,
    });
    expect(pushService.registerWithBackend).not.toHaveBeenCalled();
  });

  it('persists the rotated active session only after explicit restoration', async () => {
    jest.mocked(privacyService.cancelDeletion).mockResolvedValueOnce({
      cancelled: true,
      session: activeSession,
      user,
    });

    await useAuthStore.getState().restoreAccount();

    expect(privacyService.cancelDeletion).toHaveBeenCalledTimes(1);
    expect(tokenStorage.set).toHaveBeenCalledWith(activeSession);
    expect(useAuthStore.getState()).toMatchObject({
      status: 'authenticated',
      user,
      session: activeSession,
      error: null,
    });
    expect(pushService.registerWithBackend).toHaveBeenCalledTimes(1);
  });

  it('keeps the rotated active session in memory when Keychain persistence fails', async () => {
    jest.mocked(privacyService.cancelDeletion).mockResolvedValueOnce({
      cancelled: true,
      session: activeSession,
      user,
    });
    jest.mocked(tokenStorage.set).mockRejectedValueOnce(new Error('Keychain unavailable'));

    await expect(useAuthStore.getState().restoreAccount()).resolves.toBeUndefined();

    expect(useAuthStore.getState()).toMatchObject({
      status: 'authenticated',
      user,
      session: activeSession,
    });
    expect(tokenStorage.clear).not.toHaveBeenCalled();
    expect(reportException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ operation: 'persist-restored-auth-session' }),
    );
  });
});
