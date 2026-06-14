/**
 * Render-test for ExploreScreen. Mounts the explore feed (primed via
 * seedQueryData against `searchKeys.explore()`), and exercises the header back,
 * the "Browse topics" CTA, and tapping a trending-room / popular-club / person
 * row (each navigates). Also drives the search input to switch into the search
 * results view. Native modules are globally mocked in jest-setup.
 */
import React from 'react';
import { fireEvent } from '@testing-library/react-native';
import { searchKeys } from '../../hooks/useSearch';
import type { ExploreFeed } from '../../services/exploreService';
import { renderScreen, mockAuthenticated, resetAuth } from '../../../../test-utils/renderScreen';
import { ExploreScreen } from './ExploreScreen';

const makeFeed = (overrides: Partial<ExploreFeed> = {}): ExploreFeed => ({
  rooms: [
    {
      id: 'room-1',
      title: 'Scaling to 10M users',
      description: null,
      topic: null,
      isLive: true,
      scheduledFor: null,
      host: { id: 'u1', username: 'alex', displayName: 'Alex Rivers', avatarUrl: null },
      listenersCount: 42,
    },
  ],
  clubs: [
    {
      id: 'club-1',
      name: 'Indie Founders',
      category: 'business',
      categoryEmoji: '🚀',
      membersCount: 128,
      iconUrl: null,
      privacy: 'open',
      liveRoomsCount: 2,
    },
  ],
  users: [
    {
      id: 'user-9',
      username: 'sarahc',
      displayName: 'Sarah Chen',
      avatarUrl: null,
      bio: null,
      isOnline: true,
      followersCount: 300,
    },
  ],
  ...overrides,
});

const seedExplore = (feed: ExploreFeed) => [{ key: [...searchKeys.explore()], data: feed }];

describe('ExploreScreen', () => {
  beforeEach(() => {
    mockAuthenticated();
  });
  afterEach(() => {
    resetAuth();
    jest.restoreAllMocks();
  });

  it('mounts with the Explore title and renders the feed sections', () => {
    const { getByText, toJSON } = renderScreen(<ExploreScreen />, {
      route: { name: 'Explore', params: {} },
      seedQueryData: seedExplore(makeFeed()),
    });
    expect(toJSON()).toBeTruthy();
    expect(getByText('Explore')).toBeTruthy();
    expect(getByText('Trending rooms')).toBeTruthy();
    expect(getByText('Popular clubs')).toBeTruthy();
    expect(getByText('People to follow')).toBeTruthy();
  });

  it('renders the seeded feed items (room, club, user)', () => {
    const { getByText } = renderScreen(<ExploreScreen />, {
      route: { name: 'Explore', params: {} },
      seedQueryData: seedExplore(makeFeed()),
    });
    expect(getByText('Scaling to 10M users')).toBeTruthy();
    expect(getByText('Indie Founders')).toBeTruthy();
    expect(getByText('Sarah Chen')).toBeTruthy();
  });

  it('header back button calls navigation.goBack', () => {
    const { getAllByRole, navigation } = renderScreen(<ExploreScreen />, {
      route: { name: 'Explore', params: {} },
      seedQueryData: seedExplore(makeFeed()),
    });
    fireEvent.press(getAllByRole('button')[0]);
    expect(navigation.goBack).toHaveBeenCalledTimes(1);
  });

  it('"Browse topics" navigates to TopicExplorer', () => {
    const { getByText, navigation } = renderScreen(<ExploreScreen />, {
      route: { name: 'Explore', params: {} },
      seedQueryData: seedExplore(makeFeed()),
    });
    fireEvent.press(getByText('Browse topics'));
    expect(navigation.navigate).toHaveBeenCalledWith('TopicExplorer');
  });

  it('tapping a trending room navigates to the Room', () => {
    const { getByText, navigation } = renderScreen(<ExploreScreen />, {
      route: { name: 'Explore', params: {} },
      seedQueryData: seedExplore(makeFeed()),
    });
    fireEvent.press(getByText('Scaling to 10M users'));
    expect(navigation.navigate).toHaveBeenCalledWith('Room', { roomId: 'room-1' });
  });

  it('tapping a popular club navigates to HouseDetail', () => {
    const { getByText, navigation } = renderScreen(<ExploreScreen />, {
      route: { name: 'Explore', params: {} },
      seedQueryData: seedExplore(makeFeed()),
    });
    fireEvent.press(getByText('Indie Founders'));
    expect(navigation.navigate).toHaveBeenCalledWith('HouseDetail', { houseId: 'club-1' });
  });

  it('tapping a suggested person navigates to their Profile', () => {
    const { getByText, navigation } = renderScreen(<ExploreScreen />, {
      route: { name: 'Explore', params: {} },
      seedQueryData: seedExplore(makeFeed()),
    });
    fireEvent.press(getByText('Sarah Chen'));
    expect(navigation.navigate).toHaveBeenCalledWith('Profile', { userId: 'user-9' });
  });

  it('typing in the search bar does not crash (switches toward results view)', () => {
    const { getByPlaceholderText } = renderScreen(<ExploreScreen />, {
      route: { name: 'Explore', params: {} },
      seedQueryData: seedExplore(makeFeed()),
    });
    const input = getByPlaceholderText('Search rooms, clubs, people');
    expect(() => fireEvent.changeText(input, 'design')).not.toThrow();
  });
});
