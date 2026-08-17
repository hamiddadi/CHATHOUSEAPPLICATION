/**
 * Tests for AccountRestorationGate — the RGPD 30-day grace restoration prompt.
 * A recovery-scoped auth state must offer explicit restoration or sign-out.
 * Normal authenticated/unauthenticated states stay silent.
 */
import React from 'react';
import { Alert } from 'react-native';
import { render, waitFor, act } from '@testing-library/react-native';
import { mockAuthenticated, resetAuth } from '../../../test-utils/renderScreen';
import { useAuthStore } from '../../auth/store/authStore';
import { AccountRestorationGate } from './AccountRestorationGate';

jest.setTimeout(20000);
const WAIT = { timeout: 8000 } as const;

describe('AccountRestorationGate', () => {
  const realRestoreAccount = useAuthStore.getState().restoreAccount;
  const realSignOut = useAuthStore.getState().signOut;
  const mockRecovery = (): void => {
    mockAuthenticated({
      id: 'grace-user',
      accountState: 'PENDING_DELETION',
      deletedAt: new Date().toISOString(),
      permanentDeletionAt: new Date(Date.now() + 1000).toISOString(),
    });
    useAuthStore.setState(state => ({
      status: 'restoration_required',
      session: state.session ? { ...state.session, scope: 'account_recovery' } : null,
    }));
  };

  afterEach(() => {
    resetAuth();
    useAuthStore.setState({ restoreAccount: realRestoreAccount, signOut: realSignOut });
    jest.restoreAllMocks();
  });

  it('offers restoration only for the recovery-scoped state', async () => {
    mockRecovery();
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);

    render(<AccountRestorationGate />);

    await waitFor(() => expect(alertSpy).toHaveBeenCalledTimes(1), WAIT);
    // The Alert must carry a "Restore" action button.
    const buttons = alertSpy.mock.calls[0]?.[2] as
      | { text?: string; onPress?: () => void }[]
      | undefined;
    expect(buttons?.some(b => b.text === 'Restore')).toBe(true);
  });

  it('still offers restoration when the recovery profile is temporarily unavailable', async () => {
    mockRecovery();
    useAuthStore.setState({ user: null });
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);

    render(<AccountRestorationGate />);

    await waitFor(() => expect(alertSpy).toHaveBeenCalledTimes(1), WAIT);
    const buttons = alertSpy.mock.calls[0]?.[2] as { text?: string }[];
    expect(buttons.some(button => button.text === 'Restore')).toBe(true);
    expect(buttons.some(button => button.text === 'Sign out')).toBe(true);
  });

  it('does NOT prompt when the account is not being deleted', async () => {
    mockAuthenticated({ id: 'active-user' });
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);

    render(<AccountRestorationGate />);

    await act(async () => Promise.resolve());
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('tapping "Restore" runs the scoped restoration action', async () => {
    mockRecovery();
    const restoreAccount = jest.fn().mockResolvedValue(undefined);
    useAuthStore.setState({ restoreAccount });
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);

    render(<AccountRestorationGate />);
    await waitFor(() => expect(alertSpy).toHaveBeenCalledTimes(1), WAIT);

    // Invoke the "Restore" button's onPress as the user would.
    const buttons = alertSpy.mock.calls[0]?.[2] as { text?: string; onPress?: () => void }[];
    const restore = buttons.find(b => b.text === 'Restore');
    await act(async () => {
      await restore?.onPress?.();
    });
    expect(restoreAccount).toHaveBeenCalledTimes(1);
  });

  it('signs out when restoration is declined', async () => {
    mockRecovery();
    const signOut = jest.fn().mockResolvedValue(undefined);
    useAuthStore.setState({ signOut });
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);

    render(<AccountRestorationGate />);
    await waitFor(() => expect(alertSpy).toHaveBeenCalledTimes(1), WAIT);
    const buttons = alertSpy.mock.calls[0]?.[2] as { text?: string; onPress?: () => void }[];
    await act(async () => {
      buttons.find(button => button.text === 'Sign out')?.onPress?.();
      await Promise.resolve();
    });
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it('stays silent for an unauthenticated user', async () => {
    resetAuth();
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);

    render(<AccountRestorationGate />);

    // Give any (unwanted) async work a chance to run, then assert nothing fired.
    await act(async () => {
      await Promise.resolve();
    });
    expect(alertSpy).not.toHaveBeenCalled();
  });
});
