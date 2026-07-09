/**
 * Regression test for RoomMiniBar "resume room" navigation.
 *
 * The mini-bar renders in MainNavigator as a SIBLING of the tab navigator, so
 * its useNavigation() resolves to the ROOT stack (which owns 'Main'), NOT the
 * tab navigator. It must therefore navigate through 'Main' → 'RoomsTab' → 'Room'
 * to resume the live room. Navigating straight to 'RoomsTab' threw
 * "The action 'NAVIGATE' … was not handled by any navigator" (observed on-device)
 * and the room never re-opened.
 *
 * The default mocked navigation state (see navigationMock: getState → empty
 * routes) makes activeLeafName() return undefined, so the mini-bar is NOT on the
 * Room screen and renders — exactly the "navigated away" state it exists for.
 */
import React from 'react';
import { fireEvent } from '@testing-library/react-native';
import { renderScreen } from '../../../test-utils/renderScreen';
import { useCurrentRoomStore } from '../../../features/rooms/store/currentRoomStore';
import { RoomMiniBar } from './RoomMiniBar';

const ROOM = {
  id: 'room-xyz',
  title: 'Resume me',
  speakers: [],
  listenersCount: 3,
};

describe('RoomMiniBar', () => {
  beforeEach(() => useCurrentRoomStore.getState().clear());
  afterEach(() => useCurrentRoomStore.getState().clear());

  it('renders nothing when the user is not in a room', () => {
    const { queryByLabelText } = renderScreen(<RoomMiniBar />);
    expect(queryByLabelText(/Return to room/)).toBeNull();
  });

  it('resumes the room via Main → RoomsTab → Room (not RoomsTab directly)', () => {
    useCurrentRoomStore.getState().setRoom(ROOM);
    const { getByLabelText, navigation } = renderScreen(<RoomMiniBar />);

    fireEvent.press(getByLabelText('Return to room: Resume me'));

    // The nested shape is what makes it reachable from the root context. A bare
    // navigate('RoomsTab', …) is the regression this guards against.
    expect(navigation.navigate).toHaveBeenCalledWith('Main', {
      screen: 'RoomsTab',
      params: { screen: 'Room', params: { roomId: 'room-xyz' } },
    });
    expect(navigation.navigate).not.toHaveBeenCalledWith('RoomsTab', expect.anything());
  });
});
