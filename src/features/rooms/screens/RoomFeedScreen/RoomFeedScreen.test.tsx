import React from 'react';
import { renderScreen, screen, fireEvent, waitFor } from '../../../../test-utils/renderScreen';
import type { RoomSummary } from '../../../../shared/types/domain';
import { useRooms } from '../../hooks/useRooms';
import { RoomFeedScreen } from './RoomFeedScreen';

// Mock the data layer. `roomKeys` is real (the screen builds the "upcoming"
// query key from it); only `useRooms` is replaced so we drive the feed state.
jest.mock('../../hooks/useRooms', () => {
  const actual = jest.requireActual('../../hooks/useRooms');
  return { ...actual, useRooms: jest.fn() };
});
// The "upcoming" band runs a real useQuery against roomService.list — stub it.
jest.mock('../../services/roomService', () => ({
  roomService: { list: jest.fn().mockResolvedValue([]) },
}));
jest.mock('../../hooks/useHallwaySocket', () => ({ useHallwaySocket: jest.fn() }));
jest.mock('../../../notifications/hooks/useNotifications', () => ({
  useUnreadNotificationCount: () => ({ data: 0 }),
}));

const mockUseRooms = useRooms as jest.Mock;

const room: RoomSummary = {
  id: 'r1',
  title: 'Building in public',
  category: 'tech',
  categoryEmoji: '💻',
  houseName: null,
  speakersCount: 3,
  listenersCount: 12,
  topSpeakers: [{ id: 'u1', username: 'ada', displayName: 'Ada', avatarUrl: null }],
  topListeners: [{ id: 'u2', username: 'grace', displayName: 'Grace', avatarUrl: null }],
  participantCount: 15,
};

const queryState = (over: Partial<ReturnType<typeof mockUseRooms>>) => ({
  data: undefined,
  isLoading: false,
  isError: false,
  refetch: jest.fn(),
  isRefetching: false,
  ...over,
});

describe('RoomFeedScreen', () => {
  beforeEach(() => mockUseRooms.mockReset());

  it('shows the skeleton while loading', () => {
    mockUseRooms.mockReturnValue(queryState({ isLoading: true }));
    renderScreen(<RoomFeedScreen />);
    // Header brand still renders above the skeleton.
    expect(screen.getByText('Chathouse')).toBeTruthy();
  });

  it('renders a room card from the feed data', async () => {
    mockUseRooms.mockReturnValue(queryState({ data: [room] }));
    renderScreen(<RoomFeedScreen />);
    expect(await screen.findByText('Building in public')).toBeTruthy();
    expect(screen.getByLabelText('Join room: Building in public')).toBeTruthy();
  });

  it('shows the error empty-state when the feed errors', () => {
    mockUseRooms.mockReturnValue(queryState({ isError: true }));
    renderScreen(<RoomFeedScreen />);
    expect(screen.getByText("Couldn't load rooms")).toBeTruthy();
  });

  it('navigates to the room when Join is pressed', async () => {
    mockUseRooms.mockReturnValue(queryState({ data: [room] }));
    const { navigation } = renderScreen(<RoomFeedScreen />);
    fireEvent.press(await screen.findByLabelText('Join room: Building in public'));
    expect(navigation.navigate).toHaveBeenCalledWith('Room', { roomId: 'r1' });
  });

  it('navigates to CreateRoom from the FAB', async () => {
    mockUseRooms.mockReturnValue(queryState({ data: [room] }));
    const { navigation } = renderScreen(<RoomFeedScreen />);
    fireEvent.press(screen.getByLabelText('Start a new room'));
    await waitFor(() => expect(navigation.navigate).toHaveBeenCalledWith('CreateRoom'));
  });
});
