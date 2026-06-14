/**
 * Render test for RoomScreen.
 *
 * RoomScreen sits behind `useRoom(roomId)`; with an empty cache it shows a
 * Loader. We seed `roomKeys.detail(roomId)` with a full Room so the populated
 * stage/listeners/action-bar tree renders, then exercise the primary controls.
 *
 * Two viewer perspectives are covered because the visible buttons depend on
 * role:
 *  - HOST: sees "End Room" (confirm Alert), room controls (tune), share, chat,
 *    the mic button (canSpeak), and the action bar (hand / invite / leave).
 *  - LISTENER (non-host): sees the "Report room" flag button, no mic, no
 *    End Room; the action bar still has hand / invite / leave.
 *
 * REALTIME_ENABLED is 'false' under jest, so useRoomAudio stays idle and
 * useRoomSocket never opens a socket — the screen renders deterministically.
 */
import React from 'react';
import { Alert } from 'react-native';
import { fireEvent } from '@testing-library/react-native';
import { roomKeys } from '../../hooks/useRooms';
import { useCurrentRoomStore } from '../../store/currentRoomStore';
import type { Room, RoomParticipant } from '../../../../shared/types/domain';
import {
  renderScreen,
  mockAuthenticated,
  resetAuth,
  fakeAuthUser,
} from '../../../../test-utils/renderScreen';
import { RoomScreen } from './RoomScreen';

const ROOM_ID = 'room-test-1';
const VIEWER_ID = fakeAuthUser().id; // 'user-test-1'

const hostParticipant = (id: string): RoomParticipant => ({
  id,
  username: 'host',
  displayName: 'Host User',
  avatarUrl: null,
  role: 'host',
  audio: 'idle',
  handRaised: false,
});

const fakeRoom = (overrides: Partial<Room> = {}): Room => ({
  id: ROOM_ID,
  title: 'Deep dive on testing',
  description: null,
  category: 'tech',
  categoryEmoji: '💻',
  visibility: 'public',
  houseId: null,
  houseName: null,
  hostId: 'someone-else',
  speakers: [hostParticipant('someone-else')],
  listeners: [],
  speakersCount: 1,
  listenersCount: 0,
  isLive: true,
  isRecording: false,
  chatEnabled: true,
  chatVisibility: 'ALL',
  startedAt: new Date(Date.now() - 60_000).toISOString(),
  scheduledFor: null,
  ...overrides,
});

const mountRoom = (room: Room) =>
  renderScreen(<RoomScreen />, {
    route: { name: 'Room', params: { roomId: ROOM_ID } },
    seedQueryData: [{ key: [...roomKeys.detail(ROOM_ID)], data: room }],
  });

describe('RoomScreen', () => {
  beforeEach(() => {
    mockAuthenticated();
    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  });
  afterEach(() => {
    resetAuth();
    jest.restoreAllMocks();
  });

  it('mounts the populated room (title rendered) with seeded detail data', () => {
    const { getByText, toJSON } = mountRoom(fakeRoom());
    expect(toJSON()).toBeTruthy();
    expect(getByText('Deep dive on testing')).toBeTruthy();
  });

  describe('as a listener (non-host viewer)', () => {
    it('shows the Report button and opening it surfaces the report Alert', () => {
      const { getByLabelText } = mountRoom(fakeRoom());
      fireEvent.press(getByLabelText('Report room'));
      expect(Alert.alert).toHaveBeenCalled();
    });

    it('shares the room link via the share button without crashing', () => {
      const { getByLabelText } = mountRoom(fakeRoom());
      // Share.share is async; the press fires it fire-and-forget. We assert the
      // press itself does not throw (button has a real handler).
      expect(() => fireEvent.press(getByLabelText('Share room link'))).not.toThrow();
    });

    it('opens the chat sidebar without crashing', () => {
      const { getByLabelText } = mountRoom(fakeRoom());
      expect(() => fireEvent.press(getByLabelText('Open chat'))).not.toThrow();
    });

    it('navigates to InviteToRoom from the action-bar invite button', () => {
      const { navigation, getByLabelText } = mountRoom(fakeRoom());
      // room.invite → "Invite".
      fireEvent.press(getByLabelText('Invite'));
      expect(navigation.navigate).toHaveBeenCalledWith('InviteToRoom', { roomId: ROOM_ID });
    });

    it('leaves the room via the action-bar leave button (clears the mini-bar store)', () => {
      const { getByLabelText } = mountRoom(fakeRoom());
      // Mount mirrored the room into the global "current room" store (mini-bar).
      expect(useCurrentRoomStore.getState().room).not.toBeNull();
      // handleLeave clears the mini-bar synchronously, THEN awaits the leave
      // mutation (which hits the absent API and is caught) before goBack. The
      // synchronous clear is the deterministic, assert-able effect here; goBack
      // fires only after the network promise settles, which jest's fake API
      // never resolves quickly enough to await reliably.
      fireEvent.press(getByLabelText('Leave quietly'));
      expect(useCurrentRoomStore.getState().room).toBeNull();
    });

    it('toggles raise-hand without crashing (no mic for a listener)', () => {
      const { getByLabelText, queryByLabelText } = mountRoom(fakeRoom());
      // Listeners cannot speak → the mic button is intentionally absent.
      expect(queryByLabelText('Mute microphone')).toBeNull();
      // Raise hand has a real handler; pressing it flips local state.
      expect(() => fireEvent.press(getByLabelText('Raise hand'))).not.toThrow();
    });
  });

  describe('as the host', () => {
    const hostRoom = () =>
      fakeRoom({
        hostId: VIEWER_ID,
        speakers: [{ ...hostParticipant(VIEWER_ID), username: 'tester', displayName: 'Test User' }],
      });

    it('shows the End Room button and confirms via Alert when pressed', () => {
      const { getByLabelText } = mountRoom(hostRoom());
      fireEvent.press(getByLabelText('End Room'));
      expect(Alert.alert).toHaveBeenCalled();
    });

    it('opens room controls (tune) without crashing', () => {
      const { getByLabelText } = mountRoom(hostRoom());
      expect(() => fireEvent.press(getByLabelText('Room controls'))).not.toThrow();
    });

    it('shows the mic button (host can speak) and toggling it does not crash', () => {
      const { getByLabelText } = mountRoom(hostRoom());
      expect(() => fireEvent.press(getByLabelText('Mute microphone'))).not.toThrow();
    });
  });
});
