import React from 'react';
import { renderScreen, screen, fireEvent, waitFor } from '@/test-utils/renderScreen';
import {
  useEndRoom,
  useHandRaises,
  useLeaveRoom,
  useLowerHand,
  useRaiseHand,
  useReportRoom,
  useRoom,
  useSetMute,
} from '../../hooks/useRooms';
import { useRoomAudio } from '../../hooks/useRoomAudio';
import { useAuthStore } from '../../../auth/store/authStore';
import type { Room } from '../../../../shared/types/domain';
import { RoomScreen } from './RoomScreen';

// --- Data hooks: keep the real query-key factory + audio constants, override
// only the hooks the screen calls so no network / socket / store work runs. ---
jest.mock('../../hooks/useRooms', () => {
  const actual = jest.requireActual('../../hooks/useRooms');
  return {
    ...actual,
    useRoom: jest.fn(),
    useHandRaises: jest.fn(),
    useLeaveRoom: jest.fn(),
    useRaiseHand: jest.fn(),
    useLowerHand: jest.fn(),
    useSetMute: jest.fn(),
    useEndRoom: jest.fn(),
    useReportRoom: jest.fn(),
  };
});

jest.mock('../../hooks/useRoomAudio', () => {
  const actual = jest.requireActual('../../hooks/useRoomAudio');
  return { ...actual, useRoomAudio: jest.fn() };
});

// useRoomSocket subscribes to the realtime channel — neutralise it entirely.
jest.mock('../../hooks/useRoomSocket', () => ({ useRoomSocket: jest.fn() }));

// getSocket is async and would (in prod) wire socket listeners in an effect.
// Return null so the screen's mute/kick/role effect short-circuits cleanly.
jest.mock('../../../../shared/services/realtime/socketClient', () => ({
  getSocket: jest.fn().mockResolvedValue(null),
}));

// Auth store: support both selector and bare usage.
jest.mock('../../../auth/store/authStore', () => ({ useAuthStore: jest.fn() }));

// Child components that load their own data / open sheets — replace with inert
// stubs so the screen-under-test stays isolated from their hooks.
jest.mock('../../components/ReactionsBar', () => ({ ReactionsBar: () => null }));
jest.mock('../../components/HostActionsSheet', () => ({ HostActionsSheet: () => null }));
jest.mock('../../components/RoomChatSidebar', () => ({ RoomChatSidebar: () => null }));
jest.mock('../../components/ProfileActionSheet', () => ({ ProfileActionSheet: () => null }));
jest.mock('../../components/RoomControlsSheet', () => ({ RoomControlsSheet: () => null }));
jest.mock('../../components/TitleEditModal', () => ({ TitleEditModal: () => null }));
jest.mock('../../components/RoomTimer', () => ({ RoomTimer: () => null }));

const mockUseRoom = useRoom as jest.Mock;
const mockUseHandRaises = useHandRaises as jest.Mock;
const mockUseLeaveRoom = useLeaveRoom as jest.Mock;
const mockUseRaiseHand = useRaiseHand as jest.Mock;
const mockUseLowerHand = useLowerHand as jest.Mock;
const mockUseSetMute = useSetMute as jest.Mock;
const mockUseEndRoom = useEndRoom as jest.Mock;
const mockUseReportRoom = useReportRoom as jest.Mock;
const mockUseRoomAudio = useRoomAudio as jest.Mock;
const mockUseAuthStore = useAuthStore as unknown as jest.Mock;

const ROOM_ID = 'room-1';
const VIEWER_ID = 'viewer-1';

const queryState = (over: Record<string, unknown> = {}) => ({
  data: undefined,
  isLoading: false,
  isError: false,
  isFetching: false,
  isRefetching: false,
  error: null,
  refetch: jest.fn(),
  ...over,
});

const mutationStub = () => ({
  mutate: jest.fn(),
  mutateAsync: jest.fn().mockResolvedValue(undefined),
  isPending: false,
  isError: false,
  reset: jest.fn(),
});

const makeRoom = (over: Partial<Room> = {}): Room => ({
  id: ROOM_ID,
  title: 'Building in public',
  description: null,
  category: 'tech',
  categoryEmoji: '💻',
  visibility: 'public',
  houseId: null,
  houseName: null,
  hostId: 'host-1',
  speakers: [],
  listeners: [],
  speakersCount: 1,
  listenersCount: 0,
  isLive: true,
  isRecording: false,
  chatEnabled: true,
  chatVisibility: 'ALL',
  startedAt: new Date().toISOString(),
  scheduledFor: null,
  ...over,
});

// Default audio state: idle so the status banner is hidden.
const audioState = (over: Record<string, unknown> = {}) => ({
  status: 'idle',
  reconnecting: false,
  error: null,
  scores: new Map<string, number>(),
  setMuted: jest.fn().mockResolvedValue(undefined),
  setPeerVolume: jest.fn(),
  ...over,
});

const setAuthUser = (id: string | null) => {
  const state = { user: id ? { id } : null };
  mockUseAuthStore.mockImplementation((selector?: (s: typeof state) => unknown) =>
    selector ? selector(state) : state,
  );
};

beforeEach(() => {
  jest.clearAllMocks();
  setAuthUser(VIEWER_ID);
  mockUseRoom.mockReturnValue(queryState());
  mockUseHandRaises.mockReturnValue(queryState({ data: [] }));
  mockUseLeaveRoom.mockReturnValue(mutationStub());
  mockUseRaiseHand.mockReturnValue(mutationStub());
  mockUseLowerHand.mockReturnValue(mutationStub());
  mockUseSetMute.mockReturnValue(mutationStub());
  mockUseEndRoom.mockReturnValue(mutationStub());
  mockUseReportRoom.mockReturnValue(mutationStub());
  mockUseRoomAudio.mockReturnValue(audioState());
});

describe('RoomScreen', () => {
  it('shows the loader while the room is loading', () => {
    mockUseRoom.mockReturnValue(queryState({ isLoading: true }));
    renderScreen(<RoomScreen />, { routeParams: { roomId: ROOM_ID } });
    expect(screen.getByLabelText('Loading…')).toBeTruthy();
  });

  it('shows an unavailable empty state on error', () => {
    mockUseRoom.mockReturnValue(queryState({ isError: true }));
    renderScreen(<RoomScreen />, { routeParams: { roomId: ROOM_ID } });
    expect(screen.getByText('Room unavailable')).toBeTruthy();
    expect(screen.getByText('This room may have ended.')).toBeTruthy();
  });

  it('renders the loaded room with its title and the action bar', () => {
    mockUseRoom.mockReturnValue(queryState({ data: makeRoom() }));
    renderScreen(<RoomScreen />, { routeParams: { roomId: ROOM_ID } });
    expect(screen.getByText('Building in public')).toBeTruthy();
    expect(screen.getByText('Chathouse')).toBeTruthy();
    // Invite + Leave are available to every participant (listener viewer here).
    expect(screen.getByLabelText('Invite')).toBeTruthy();
    expect(screen.getByLabelText('Leave quietly')).toBeTruthy();
  });

  it('navigates to InviteToRoom when the invite button is pressed', () => {
    mockUseRoom.mockReturnValue(queryState({ data: makeRoom() }));
    const { navigation } = renderScreen(<RoomScreen />, { routeParams: { roomId: ROOM_ID } });
    fireEvent.press(screen.getByLabelText('Invite'));
    expect(navigation.navigate).toHaveBeenCalledWith('InviteToRoom', { roomId: ROOM_ID });
  });

  it('leaves the room and pops the screen when leave is pressed', async () => {
    const leave = mutationStub();
    mockUseLeaveRoom.mockReturnValue(leave);
    mockUseRoom.mockReturnValue(queryState({ data: makeRoom() }));
    const { navigation } = renderScreen(<RoomScreen />, { routeParams: { roomId: ROOM_ID } });
    fireEvent.press(screen.getByLabelText('Leave quietly'));
    await waitFor(() => expect(leave.mutateAsync).toHaveBeenCalledWith(ROOM_ID));
    await waitFor(() => expect(navigation.goBack).toHaveBeenCalled());
  });

  it('shows the host End Room control when the viewer is the host', () => {
    setAuthUser(VIEWER_ID);
    mockUseRoom.mockReturnValue(queryState({ data: makeRoom({ hostId: VIEWER_ID }) }));
    renderScreen(<RoomScreen />, { routeParams: { roomId: ROOM_ID } });
    // Host sees the destructive "End Room" button (a11y label = room.closeRoom).
    expect(screen.getByLabelText('End Room')).toBeTruthy();
  });
});
