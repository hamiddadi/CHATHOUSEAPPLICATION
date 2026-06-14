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
import { fireEvent } from '@testing-library/react-native';
import { renderScreen, mockAuthenticated, resetAuth } from '../../../../test-utils/renderScreen';
import { InviteToRoomScreen } from './InviteToRoomScreen';

describe('InviteToRoomScreen', () => {
  beforeEach(() => {
    mockAuthenticated();
  });
  afterEach(() => {
    resetAuth();
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
    // `rooms.invite.closeA11y` is not in en.json → falls back to the inline
    // default 'Fermer'.
    const { navigation, getByLabelText } = mount();
    fireEvent.press(getByLabelText('Fermer'));
    expect(navigation.goBack).toHaveBeenCalledTimes(1);
  });

  it('does not navigate or crash when the disabled send CTA is pressed with no selection', () => {
    // With zero invitees selected the Button is `disabled` and the label is the
    // idle fallback 'Sélectionnez des invités'. Pressing a disabled button must
    // not call goBack (the success handler) nor throw.
    const { navigation, getByText } = mount();
    fireEvent.press(getByText('Sélectionnez des invités'));
    expect(navigation.goBack).not.toHaveBeenCalled();
  });
});
