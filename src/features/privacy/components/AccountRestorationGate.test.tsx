/**
 * Tests for AccountRestorationGate — the RGPD 30-day grace restoration prompt.
 * When an authenticated user is inside the deletion grace window, the gate must
 * offer a "Restore" Alert wired to privacyService.cancelDeletion. When they are
 * not deleting, it must stay silent.
 */
import React from 'react';
import { Alert } from 'react-native';
import { render, waitFor, act } from '@testing-library/react-native';
import { mockAuthenticated, resetAuth } from '../../../test-utils/renderScreen';
import { privacyService } from '../services/privacyService';
import { AccountRestorationGate } from './AccountRestorationGate';

jest.setTimeout(20000);
const WAIT = { timeout: 8000 } as const;

describe('AccountRestorationGate', () => {
  afterEach(() => {
    resetAuth();
    jest.restoreAllMocks();
  });

  it('offers to restore when the authenticated account is in the grace period', async () => {
    mockAuthenticated({ id: 'grace-user' });
    jest.spyOn(privacyService, 'getDeletionStatus').mockResolvedValue({
      inGracePeriod: true,
      deletedAt: new Date().toISOString(),
      permanentDeletionAt: new Date(Date.now() + 1000).toISOString(),
    });
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);

    render(<AccountRestorationGate />);

    await waitFor(() => expect(alertSpy).toHaveBeenCalledTimes(1), WAIT);
    // The Alert must carry a "Restore" action button.
    const buttons = alertSpy.mock.calls[0]?.[2] as
      | { text?: string; onPress?: () => void }[]
      | undefined;
    expect(buttons?.some(b => b.text === 'Restore')).toBe(true);
  });

  it('does NOT prompt when the account is not being deleted', async () => {
    mockAuthenticated({ id: 'active-user' });
    const statusSpy = jest.spyOn(privacyService, 'getDeletionStatus').mockResolvedValue({
      inGracePeriod: false,
      deletedAt: null,
      permanentDeletionAt: null,
    });
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);

    render(<AccountRestorationGate />);

    await waitFor(() => expect(statusSpy).toHaveBeenCalled(), WAIT);
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('tapping "Restore" calls privacyService.cancelDeletion', async () => {
    mockAuthenticated({ id: 'grace-user' });
    jest.spyOn(privacyService, 'getDeletionStatus').mockResolvedValue({
      inGracePeriod: true,
      deletedAt: new Date().toISOString(),
      permanentDeletionAt: new Date(Date.now() + 1000).toISOString(),
    });
    const cancelSpy = jest
      .spyOn(privacyService, 'cancelDeletion')
      .mockResolvedValue({ cancelled: true });
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);

    render(<AccountRestorationGate />);
    await waitFor(() => expect(alertSpy).toHaveBeenCalledTimes(1), WAIT);

    // Invoke the "Restore" button's onPress as the user would.
    const buttons = alertSpy.mock.calls[0]?.[2] as { text?: string; onPress?: () => void }[];
    const restore = buttons.find(b => b.text === 'Restore');
    await act(async () => {
      await restore?.onPress?.();
    });
    expect(cancelSpy).toHaveBeenCalledTimes(1);
  });

  it('stays silent for an unauthenticated user', async () => {
    resetAuth();
    const statusSpy = jest.spyOn(privacyService, 'getDeletionStatus');
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);

    render(<AccountRestorationGate />);

    // Give any (unwanted) async work a chance to run, then assert nothing fired.
    await act(async () => {
      await Promise.resolve();
    });
    expect(statusSpy).not.toHaveBeenCalled();
    expect(alertSpy).not.toHaveBeenCalled();
  });
});
