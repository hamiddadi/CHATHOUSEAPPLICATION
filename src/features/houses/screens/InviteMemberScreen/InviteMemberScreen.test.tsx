/**
 * InviteMemberScreen render + button tests. Route carries { houseId }. User
 * search is debounced + disabled while the query is empty, so on mount the
 * screen shows its empty state (no loader, no rows) — a clean mount. We
 * exercise the always-present CTAs: close (goBack) and the copy-invite-link
 * button (Clipboard is globally mocked; on success it opens a confirm Alert).
 */
import React from 'react';
import { Alert } from 'react-native';
import { fireEvent, waitFor } from '@testing-library/react-native';
import { renderScreen, mockAuthenticated, resetAuth } from '../../../../test-utils/renderScreen';
import { InviteMemberScreen } from './InviteMemberScreen';

const ROUTE = { name: 'InviteMember', params: { houseId: 'house-1' } };

describe('InviteMemberScreen', () => {
  beforeEach(() => {
    mockAuthenticated();
  });
  afterEach(() => {
    resetAuth();
    jest.restoreAllMocks();
  });

  it('mounts and shows the title + the shareable invite link', () => {
    const { toJSON, getByText } = renderScreen(<InviteMemberScreen />, { route: ROUTE });
    expect(toJSON()).toBeTruthy();
    // i18n en.json: houses.invite.title === 'Invite Member'.
    expect(getByText('Invite Member')).toBeTruthy();
    // The on-screen invite link is derived from the route houseId.
    expect(getByText('app.chathouse.com/invite/house-1')).toBeTruthy();
  });

  it('close button calls navigation.goBack', () => {
    const { navigation, getByLabelText } = renderScreen(<InviteMemberScreen />, { route: ROUTE });
    fireEvent.press(getByLabelText('Close invite dialog'));
    expect(navigation.goBack).toHaveBeenCalledTimes(1);
  });

  it('copy-link button copies the URL and opens the confirm Alert', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const { getByLabelText } = renderScreen(<InviteMemberScreen />, { route: ROUTE });
    fireEvent.press(getByLabelText('Copy invite link'));
    // Clipboard.setString resolves async (mock) → Alert is fired after the await.
    await waitFor(() => expect(alertSpy).toHaveBeenCalled());
  });

  it('typing a search query does not crash the screen', () => {
    const { getByPlaceholderText, toJSON } = renderScreen(<InviteMemberScreen />, { route: ROUTE });
    fireEvent.changeText(getByPlaceholderText('Search users'), 'alice');
    expect(toJSON()).toBeTruthy();
  });
});
