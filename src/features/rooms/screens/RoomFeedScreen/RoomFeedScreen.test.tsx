/**
 * Render test for RoomFeedScreen.
 *
 * Mounts the feed, seeds the rooms-list infinite query (key = [...roomKeys.list(), {}])
 * with one live room so the FlatList renders a RoomCard past the skeleton, then
 * exercises the header icons (each navigates), the FAB (CreateRoom), a filter
 * pill (local state, no crash) and the card's Join button (navigates to Room).
 */
import React from 'react';
import { fireEvent, waitFor } from '@testing-library/react-native';
import { roomKeys } from '../../hooks/useRooms';
import { roomService } from '../../services/roomService';
import type { RoomSummary } from '../../../../shared/types/domain';
import { renderScreen, mockAuthenticated, resetAuth } from '../../../../test-utils/renderScreen';
import { RoomFeedScreen } from './RoomFeedScreen';

const fakeRoom = (overrides: Partial<RoomSummary> = {}): RoomSummary => ({
  id: 'room-feed-1',
  title: 'Morning standup',
  category: 'tech',
  categoryEmoji: '💻',
  houseName: null,
  speakersCount: 2,
  listenersCount: 10,
  topSpeakers: [{ id: 'u1', username: 'alice', displayName: 'Alice', avatarUrl: null }],
  topListeners: [{ id: 'u2', username: 'bob', displayName: 'Bob', avatarUrl: null }],
  isLive: true,
  ...overrides,
});

describe('RoomFeedScreen', () => {
  beforeEach(() => {
    mockAuthenticated();
  });
  afterEach(() => {
    resetAuth();
    jest.restoreAllMocks();
  });

  const mount = () =>
    renderScreen(<RoomFeedScreen />, {
      route: { name: 'RoomFeed' },
      // Default filter is 'All' → params {} → key [...list(), {}]. useRooms is an
      // infinite query, so the cache holds a paged shape, not a flat array.
      seedQueryData: [
        { key: [...roomKeys.list(), {}], data: { pages: [[fakeRoom()]], pageParams: [0] } },
      ],
    });

  // Seed an EMPTY first page so the FlatList renders its ListEmptyComponent.
  const mountEmpty = () =>
    renderScreen(<RoomFeedScreen />, {
      route: { name: 'RoomFeed' },
      seedQueryData: [{ key: [...roomKeys.list(), {}], data: { pages: [[]], pageParams: [0] } }],
    });

  it('mounts and renders the seeded room card + Live Now header', () => {
    const { getByText, toJSON } = mount();
    expect(toJSON()).toBeTruthy();
    expect(getByText('Live Now')).toBeTruthy();
    expect(getByText('Morning standup')).toBeTruthy();
  });

  it('navigates from each header icon to its destination', () => {
    const { navigation, getByLabelText } = mount();
    fireEvent.press(getByLabelText('Explore'));
    expect(navigation.navigate).toHaveBeenCalledWith('Explore');
    fireEvent.press(getByLabelText('Events'));
    expect(navigation.navigate).toHaveBeenCalledWith('Events');
    fireEvent.press(getByLabelText('Replays'));
    expect(navigation.navigate).toHaveBeenCalledWith('Replays');
  });

  it('navigates to the ActivityFeed from the header activity bell', () => {
    const { navigation, getByLabelText } = mount();
    fireEvent.press(getByLabelText('Activity'));
    expect(navigation.navigate).toHaveBeenCalledWith('ActivityFeed');
  });

  it('shows the empty-feed CTA and starting a room from it opens CreateRoom', () => {
    const { navigation, getByText } = mountEmpty();
    // ListEmptyComponent renders its title + "Start a room" CTA.
    expect(getByText('No live rooms right now')).toBeTruthy();
    fireEvent.press(getByText('Start a room'));
    expect(navigation.navigate).toHaveBeenCalledWith('CreateRoom');
  });

  it('renders a retry-able error state when the feed fails to load', async () => {
    // No seed + a rejecting service → useRooms settles into isError, which
    // must render the error EmptyState with a Retry button (not a blank feed).
    const listSpy = jest.spyOn(roomService, 'list').mockRejectedValue(new Error('network'));
    const { getByText } = renderScreen(<RoomFeedScreen />, { route: { name: 'RoomFeed' } });
    await waitFor(() => expect(getByText("Couldn't load rooms")).toBeTruthy());
    expect(getByText('Retry')).toBeTruthy();
    expect(listSpy).toHaveBeenCalled();
  });

  it('opens CreateRoom from the FAB', () => {
    const { navigation, getByLabelText } = mount();
    fireEvent.press(getByLabelText('Start a new room'));
    expect(navigation.navigate).toHaveBeenCalledWith('CreateRoom');
  });

  it('joins a room from the card Join button', () => {
    const { navigation, getByLabelText } = mount();
    fireEvent.press(getByLabelText('Join room: Morning standup'));
    expect(navigation.navigate).toHaveBeenCalledWith('Room', { roomId: 'room-feed-1' });
  });

  it('toggles a filter pill without crashing', () => {
    const { getByLabelText } = mount();
    // Filter pills carry accessibilityLabel `Filter: <label>`; pressing one
    // flips local state and refetches — must not throw.
    fireEvent.press(getByLabelText('Filter: Following'));
    expect(getByLabelText('Filter: Following')).toBeTruthy();
  });
});
