import React from 'react';
import { renderScreen, screen, fireEvent, waitFor } from '@/test-utils/renderScreen';
import { i18n } from '@/core/i18n';
import { useExplore, useSearch } from '../../hooks/useSearch';
import type { ExploreFeed } from '../../services/exploreService';
import type { SearchResults } from '../../services/searchService';
import { ExploreScreen } from './ExploreScreen';

jest.mock('../../hooks/useSearch', () => {
  const actual = jest.requireActual('../../hooks/useSearch');
  return { ...actual, useExplore: jest.fn(), useSearch: jest.fn() };
});

const mockUseExplore = useExplore as jest.Mock;
const mockUseSearch = useSearch as jest.Mock;

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

const exploreFeed: ExploreFeed = {
  rooms: [
    {
      id: 'room-1',
      title: 'Building in public',
      description: null,
      topic: null,
      isLive: true,
      scheduledFor: null,
      host: { id: 'host-1', username: 'ada', displayName: 'Ada', avatarUrl: null },
      listenersCount: 12,
    },
  ],
  clubs: [
    {
      id: 'club-1',
      name: 'Founders Club',
      categoryEmoji: '🚀',
      membersCount: 99,
      liveRoomsCount: 2,
    } as ExploreFeed['clubs'][number],
  ],
  users: [
    {
      id: 'user-1',
      username: 'grace',
      displayName: 'Grace Hopper',
      avatarUrl: null,
      bio: null,
      isOnline: true,
      followersCount: 5,
    } as ExploreFeed['users'][number],
  ],
};

const searchResults: SearchResults = {
  users: [
    {
      id: 'user-9',
      username: 'linus',
      displayName: 'Linus',
      avatarUrl: null,
      bio: null,
      isOnline: false,
    } as SearchResults['users'][number],
  ],
  clubs: [],
  rooms: [],
};

const emptySearch: SearchResults = { users: [], clubs: [], rooms: [] };

describe('ExploreScreen', () => {
  beforeEach(() => {
    mockUseExplore.mockReset();
    mockUseSearch.mockReset();
    mockUseExplore.mockReturnValue(queryState());
    mockUseSearch.mockReturnValue(queryState());
  });

  it('renders the explore header and search input', () => {
    renderScreen(<ExploreScreen />);
    expect(screen.getByText(i18n.t('explore.title'))).toBeTruthy();
    expect(screen.getByPlaceholderText(i18n.t('explore.searchPlaceholder'))).toBeTruthy();
  });

  it('shows the explore feed loader while the feed is loading', () => {
    mockUseExplore.mockReturnValue(queryState({ isLoading: true }));
    renderScreen(<ExploreScreen />);
    expect(screen.getByLabelText(i18n.t('explore.title'))).toBeTruthy();
  });

  it('renders the loaded explore feed sections', () => {
    mockUseExplore.mockReturnValue(queryState({ data: exploreFeed }));
    renderScreen(<ExploreScreen />);
    expect(screen.getByText('Building in public')).toBeTruthy();
    expect(screen.getByText('Founders Club')).toBeTruthy();
    expect(screen.getByText('Grace Hopper')).toBeTruthy();
  });

  it('navigates back when the back button is pressed', () => {
    mockUseExplore.mockReturnValue(queryState({ data: exploreFeed }));
    const { navigation } = renderScreen(<ExploreScreen />);
    fireEvent.press(screen.getAllByRole('button')[0]);
    expect(navigation.goBack).toHaveBeenCalled();
  });

  it('navigates to the room when a feed room row is pressed', () => {
    mockUseExplore.mockReturnValue(queryState({ data: exploreFeed }));
    const { navigation } = renderScreen(<ExploreScreen />);
    fireEvent.press(screen.getByText('Building in public'));
    expect(navigation.navigate).toHaveBeenCalledWith('Room', { roomId: 'room-1' });
  });

  it('switches to search results once the user types a query', async () => {
    mockUseSearch.mockReturnValue(queryState({ data: searchResults }));
    renderScreen(<ExploreScreen />);
    fireEvent.changeText(screen.getByPlaceholderText(i18n.t('explore.searchPlaceholder')), 'linus');
    expect(await screen.findByText('Linus')).toBeTruthy();
  });

  it('shows the empty search state when no results match', async () => {
    mockUseSearch.mockReturnValue(queryState({ data: emptySearch }));
    renderScreen(<ExploreScreen />);
    fireEvent.changeText(screen.getByPlaceholderText(i18n.t('explore.searchPlaceholder')), 'zzz');
    await waitFor(() =>
      expect(screen.getByText(i18n.t('explore.searchEmpty', { q: 'zzz' }))).toBeTruthy(),
    );
  });
});
