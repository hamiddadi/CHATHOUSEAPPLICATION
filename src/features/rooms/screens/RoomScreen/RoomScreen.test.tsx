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
import { act, fireEvent, waitFor } from '@testing-library/react-native';
import { roomKeys } from '../../hooks/useRooms';
import { roomService } from '../../services/roomService';
import { useCurrentRoomStore } from '../../store/currentRoomStore';
import type { Room, RoomParticipant } from '../../../../shared/types/domain';
import {
  renderScreen,
  mockAuthenticated,
  resetAuth,
  fakeAuthUser,
} from '../../../../test-utils/renderScreen';
import { RoomScreen } from './RoomScreen';

const mockAudioRetry = jest.fn().mockResolvedValue(undefined);
const mockAudioSetMuted = jest.fn().mockResolvedValue(undefined);
interface MockAudioState {
  status: 'idle' | 'error';
  reconnecting: boolean;
  error: string | null;
  scores: ReadonlyMap<string, number>;
  retry: typeof mockAudioRetry;
  setMuted: typeof mockAudioSetMuted;
  setPeerVolume: jest.Mock;
}
const mockUseRoomAudio = jest.fn<MockAudioState, []>(() => ({
  status: 'idle',
  reconnecting: false,
  error: null,
  scores: new Map(),
  retry: mockAudioRetry,
  setMuted: mockAudioSetMuted,
  setPeerVolume: jest.fn(),
}));

jest.mock('../../hooks/useRoomAudio', () => ({
  SPEAKING_SCORE_THRESHOLD: 0.5,
  SPEAKING_SELF_KEY: '__self__',
  useRoomAudio: () => mockUseRoomAudio(),
}));

// Membership ordering is covered by useRoomMembership.test.tsx. These render
// tests exercise the populated in-room controls after that prerequisite.
jest.mock('../../hooks/useRoomMembership', () => ({
  useRoomMembership: () => ({
    status: 'joined',
    error: null,
    retry: jest.fn(),
  }),
}));

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
    mockUseRoomAudio.mockReturnValue({
      status: 'idle',
      reconnecting: false,
      error: null,
      scores: new Map(),
      retry: mockAudioRetry,
      setMuted: mockAudioSetMuted,
      setPeerVolume: jest.fn(),
    });
    // Clear BEFORE each mount too: a prior test's still-mounted screen (RTL
    // unmounts in its own afterEach, which may run after ours) can otherwise
    // leave the shared store holding this room id, skipping mute hydration.
    useCurrentRoomStore.getState().clear();
    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  });
  afterEach(() => {
    resetAuth();
    useCurrentRoomStore.getState().clear();
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

    it('localizes an audio failure and lets the user retry without exposing SDK details', () => {
      mockUseRoomAudio.mockReturnValue({
        status: 'error',
        reconnecting: false,
        error: 'could not establish signal connection',
        scores: new Map(),
        retry: mockAudioRetry,
        setMuted: mockAudioSetMuted,
        setPeerVolume: jest.fn(),
      });
      const { getByLabelText, getByText, queryByText } = mountRoom(fakeRoom());

      expect(
        getByText('❌ Live audio is unavailable. Check your connection and try again.'),
      ).toBeTruthy();
      expect(queryByText('could not establish signal connection')).toBeNull();

      fireEvent.press(getByLabelText('Retry audio'));
      expect(mockAudioRetry).toHaveBeenCalledTimes(1);
    });

    it('navigates to InviteToRoom from the action-bar invite button', () => {
      const { navigation, getByLabelText } = mountRoom(fakeRoom());
      // room.invite → "Invite".
      fireEvent.press(getByLabelText('Invite'));
      expect(navigation.navigate).toHaveBeenCalledWith('InviteToRoom', { roomId: ROOM_ID });
    });

    it('leaves the room via the action-bar leave button and waits for completion', async () => {
      const leaveSpy = jest.spyOn(roomService, 'leave').mockResolvedValue({ left: true });
      const { navigation, getByLabelText } = mountRoom(fakeRoom());
      // Mount mirrored the room into the global "current room" store (mini-bar).
      expect(useCurrentRoomStore.getState().room).not.toBeNull();
      fireEvent.press(getByLabelText('Leave quietly'));
      expect(useCurrentRoomStore.getState().room).toBeNull();
      await waitFor(() => {
        expect(leaveSpy).toHaveBeenCalledWith(ROOM_ID);
        expect(navigation.goBack).toHaveBeenCalledTimes(1);
      });
    });

    it('toggles raise-hand without crashing (no mic for a listener)', () => {
      const { getByLabelText, queryByLabelText } = mountRoom(fakeRoom());
      // Listeners cannot speak → the mic button is intentionally absent.
      expect(queryByLabelText('Mute microphone')).toBeNull();
      // Raise hand has a real handler; pressing it flips local state.
      expect(() => fireEvent.press(getByLabelText('Raise hand'))).not.toThrow();
    });

    it('returns to Raise hand when the authoritative queue is cleared externally', async () => {
      const { getByLabelText, queryClient } = mountRoom(fakeRoom());
      act(() => {
        queryClient.setQueryData(roomKeys.handRaises(ROOM_ID), [
          {
            id: VIEWER_ID,
            username: 'tester',
            displayName: 'Test User',
            avatarUrl: null,
            raisedAt: '2026-07-29T10:00:00.000Z',
          },
        ]);
      });
      await waitFor(() => expect(getByLabelText('Lower hand')).toBeTruthy());

      act(() => {
        queryClient.setQueryData(roomKeys.handRaises(ROOM_ID), []);
      });
      await waitFor(() => expect(getByLabelText('Raise hand')).toBeTruthy());
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

    // BLOQUANT regression guard: the mute badge is driven by the shared
    // currentRoomStore, not screen-local state, and MUST survive a room-detail
    // refetch (setRoom). Before the fix, a refetch reset isMuted and the mic
    // silently re-opened while the badge still read "muted".
    it('drives the mic button from the store and keeps mute across a refetch', () => {
      // Backend accepts the mute so the optimistic flip is NOT rolled back.
      jest.spyOn(roomService, 'setMute').mockResolvedValue(undefined as never);
      // Prevent the onSuccess invalidation from firing an unmocked GET refetch.
      jest.spyOn(roomService, 'get').mockImplementation(() => new Promise(() => undefined));
      const { getByLabelText, queryByLabelText, queryClient } = mountRoom(hostRoom());

      // Optimistic mute writes the shared store → the button flips to "Unmute".
      fireEvent.press(getByLabelText('Mute microphone'));
      expect(useCurrentRoomStore.getState().isMuted).toBe(true);
      expect(getByLabelText('Unmute microphone')).toBeTruthy();
      expect(queryByLabelText('Mute microphone')).toBeNull();

      // Simulate a React Query detail refetch: a fresh room object (same id,
      // new listenersCount) replaces the cache. This re-runs setRoom.
      act(() => {
        queryClient.setQueryData([...roomKeys.detail(ROOM_ID)], {
          ...hostRoom(),
          listenersCount: 7,
        });
      });

      // The mute flag — and therefore the "Unmute" button — must persist.
      expect(useCurrentRoomStore.getState().isMuted).toBe(true);
      expect(getByLabelText('Unmute microphone')).toBeTruthy();
    });

    // Hydration: entering a room whose own participant row is already muted
    // (server state) seeds the store so the badge matches on first paint.
    it('hydrates isMuted from the viewer participant row on room entry', () => {
      const mutedHostRoom = fakeRoom({
        hostId: VIEWER_ID,
        speakers: [
          {
            ...hostParticipant(VIEWER_ID),
            username: 'tester',
            displayName: 'Test User',
            audio: 'muted',
          },
        ],
      });
      const { getByLabelText } = mountRoom(mutedHostRoom);
      expect(useCurrentRoomStore.getState().isMuted).toBe(true);
      expect(getByLabelText('Unmute microphone')).toBeTruthy();
    });
  });
});
