/**
 * Render-test for DeleteAccountScreen. Mounts the account-deletion screen and
 * exercises its single destructive CTA. The Delete button is gated: it stays
 * `disabled` until the confirmation phrase ("DELETE") is typed into the input.
 * Once enabled, pressing it opens a confirm Alert whose destructive action
 * calls `privacyService.requestDeletion()` then the auth-store `signOut`.
 *
 * We assert the disabled→enabled gate, that the Alert is shown, and that
 * invoking the Alert's destructive button runs the deletion + sign-out path.
 * `requestDeletion` and the store's `signOut` action are stubbed so the path
 * runs without a network call or a real session teardown.
 */
import React from 'react';
import { Alert } from 'react-native';
import { fireEvent, waitFor } from '@testing-library/react-native';
import { useAuthStore } from '../../auth/store/authStore';
import { renderScreen, mockAuthenticated, resetAuth } from '../../../test-utils/renderScreen';
import { privacyService } from '../services/privacyService';
import { DeleteAccountScreen } from './DeleteAccountScreen';

type AlertButton = { text?: string; style?: string; onPress?: () => void };

describe('DeleteAccountScreen', () => {
  beforeEach(() => {
    mockAuthenticated();
  });
  afterEach(() => {
    resetAuth();
    jest.restoreAllMocks();
  });

  it('mounts and renders the title, warning + the confirm input', () => {
    const { getByText, getByLabelText, toJSON } = renderScreen(<DeleteAccountScreen />);
    expect(toJSON()).toBeTruthy();
    expect(getByText('Delete my account')).toBeTruthy();
    expect(getByText('⚠️ Near-irreversible action')).toBeTruthy();
    expect(getByLabelText('Deletion confirmation input')).toBeTruthy();
  });

  it('Delete button is gated: no Alert until the confirm phrase is typed', () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const { getByText } = renderScreen(<DeleteAccountScreen />);

    // Button is disabled (Button passes onPress=undefined when disabled) → no Alert.
    fireEvent.press(getByText('Delete my account permanently'));
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('typing DELETE enables the button; pressing it opens the confirm Alert', () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const { getByText, getByLabelText } = renderScreen(<DeleteAccountScreen />);

    fireEvent.changeText(getByLabelText('Deletion confirmation input'), 'delete');
    fireEvent.press(getByText('Delete my account permanently'));

    // Confirmation is case-insensitive ("delete" === "DELETE") → Alert shown.
    expect(alertSpy).toHaveBeenCalledTimes(1);
    expect(alertSpy.mock.calls[0]?.[0]).toBe('Delete my account');
  });

  it("Alert's destructive action runs requestDeletion then signOut", async () => {
    const requestSpy = jest
      .spyOn(privacyService, 'requestDeletion')
      .mockResolvedValue({ deletedAt: 'now', permanentDeletionAt: 'later' });
    const signOutSpy = jest.fn().mockResolvedValue(undefined);
    // The screen reads signOut from the store via a selector — override the
    // action so the real session-teardown side-effects don't run under jest.
    useAuthStore.setState({ signOut: signOutSpy });

    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const { getByText, getByLabelText } = renderScreen(<DeleteAccountScreen />);

    fireEvent.changeText(getByLabelText('Deletion confirmation input'), 'DELETE');
    fireEvent.press(getByText('Delete my account permanently'));

    // Pull the destructive button out of the Alert call and fire its onPress.
    const buttons = alertSpy.mock.calls[0]?.[2] as AlertButton[] | undefined;
    const destructive = buttons?.find(b => b.style === 'destructive');
    expect(destructive).toBeDefined();
    destructive?.onPress?.();

    await waitFor(() => expect(requestSpy).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(signOutSpy).toHaveBeenCalledTimes(1));
  });
});
