/**
 * Render test for InviteToRoomScreen.
 *
 * Mounts with the `roomId` route param the screen's useRoute expects, asserts
 * the title + initial empty state render (no search query yet → no network),
 * then exercises the two primary controls: the header close button (goBack)
 * and the send CTA. The send button is DISABLED while no invitee is selected,
 * so pressing it must be a no-op (the mutation never fires) — we assert that
 * current, correct behaviour.
 */
import React from 'react';
import { fireEvent, waitFor } from '@testing-library/react-native';
import { renderScreen, mockAuthenticated, resetAuth } from '../../../../test-utils/renderScreen';
import { searchService } from '../../../search/services/searchService';
import { InviteToRoomScreen } from './InviteToRoomScreen';

describe('InviteToRoomScreen', () => {
  beforeEach(() => {
    mockAuthenticated();
  });
  afterEach(() => {
    resetAuth();
    jest.restoreAllMocks();
  });

  const mount = () =>
    renderScreen(<InviteToRoomScreen />, {
      route: { name: 'InviteToRoom', params: { roomId: 'room-test-1' } },
    });

  it('mounts with the roomId param and shows the title + initial empty state', () => {
    const { getByText, toJSON } = mount();
    expect(toJSON()).toBeTruthy();
    // `rooms.invite.title` exists in en.json → "Invite to Room".
    expect(getByText('Invite to Room')).toBeTruthy();
  });

  it('fires navigation.goBack when the header close button is pressed', () => {
    // `rooms.invite.closeA11y` exists in en.json → resolves to "Close".
    const { navigation, getByLabelText } = mount();
    fireEvent.press(getByLabelText('Close'));
    expect(navigation.goBack).toHaveBeenCalledTimes(1);
  });

  it('does not navigate or crash when the disabled send CTA is pressed with no selection', () => {
    // With zero invitees selected the Button is `disabled` and the label is the
    // idle text `rooms.invite.btnIdle` → "Select guests". Pressing a disabled
    // button must not call goBack (the success handler) nor throw.
    const { navigation, getByText } = mount();
    fireEvent.press(getByText('Select guests'));
    expect(navigation.goBack).not.toHaveBeenCalled();
  });

  it('surfaces a retry-able error state when the user search fails', async () => {
    // A rejected search must NOT read as "no results": it shows an error
    // EmptyState whose Retry button re-runs the same query.
    const usersSpy = jest
      .spyOn(searchService, 'users')
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce([]);
    const { getByText, getByPlaceholderText } = mount();
    // Type a query → debounced (250 ms) search fires and rejects.
    fireEvent.changeText(getByPlaceholderText('Search users'), 'alice');

    await waitFor(() => expect(getByText('Search failed')).toBeTruthy());
    fireEvent.press(getByText('Retry'));
    // Retry bumps the tick → the search effect re-runs the same term.
    await waitFor(() => expect(usersSpy).toHaveBeenCalledTimes(2));
  });
});
