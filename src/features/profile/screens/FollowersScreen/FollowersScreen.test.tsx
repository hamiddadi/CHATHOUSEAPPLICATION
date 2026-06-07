import React from 'react';
import { renderScreen, screen, fireEvent, waitFor } from '@/test-utils/renderScreen';
import { i18n } from '@/core/i18n';
import type { User } from '../../../../shared/types/domain';
import { useFollow, useFollowers, useFollowing, useUnfollow } from '../../hooks/useProfile';
import { FollowersScreen } from './FollowersScreen';

jest.mock('../../hooks/useProfile', () => {
  const actual = jest.requireActual('../../hooks/useProfile');
  return {
    ...actual,
    useFollowers: jest.fn(),
    useFollowing: jest.fn(),
    useFollow: jest.fn(),
    useUnfollow: jest.fn(),
  };
});

const mockUseFollowers = useFollowers as unknown as jest.Mock;
const mockUseFollowing = useFollowing as unknown as jest.Mock;
const mockUseFollow = useFollow as unknown as jest.Mock;
const mockUseUnfollow = useUnfollow as unknown as jest.Mock;

const queryState = (over: Record<string, unknown> = {}) => ({
  data: undefined,
  isLoading: false,
  isError: false,
  isRefetching: false,
  isFetching: false,
  error: null,
  refetch: jest.fn(),
  ...over,
});

const mutationState = (over: Record<string, unknown> = {}) => ({
  mutate: jest.fn(),
  mutateAsync: jest.fn().mockResolvedValue(undefined),
  isPending: false,
  isError: false,
  variables: undefined,
  reset: jest.fn(),
  ...over,
});

const makeUser = (over: Partial<User> = {}): User => ({
  id: 'u1',
  username: 'janedoe',
  displayName: 'Jane Doe',
  bio: null,
  avatarUrl: null,
  followersCount: 0,
  followingCount: 0,
  isFollowedByMe: false,
  isOnline: false,
  createdAt: '2024-01-01T00:00:00.000Z',
  ...over,
});

const routeParams = { userId: 'me-1' };

describe('FollowersScreen', () => {
  beforeEach(() => {
    mockUseFollowers.mockReset();
    mockUseFollowing.mockReset();
    mockUseFollow.mockReset();
    mockUseUnfollow.mockReset();
    mockUseFollow.mockReturnValue(mutationState());
    mockUseUnfollow.mockReturnValue(mutationState());
  });

  it('renders the header with the followers tab selected by default', () => {
    mockUseFollowers.mockReturnValue(queryState({ data: [] }));
    mockUseFollowing.mockReturnValue(queryState({ data: [] }));
    renderScreen(<FollowersScreen />, { routeParams, routeName: 'Followers' });
    expect(screen.getByText(i18n.t('profile.connections', 'Connections'))).toBeTruthy();
  });

  it('shows the loader while the active list is loading', () => {
    mockUseFollowers.mockReturnValue(queryState({ isLoading: true }));
    mockUseFollowing.mockReturnValue(queryState({ data: [] }));
    renderScreen(<FollowersScreen />, { routeParams, routeName: 'Followers' });
    expect(
      screen.getByLabelText(i18n.t('profile.loadingConnections', 'Loading connections')),
    ).toBeTruthy();
  });

  it('shows the error state when the active query errors', () => {
    mockUseFollowers.mockReturnValue(queryState({ isError: true }));
    mockUseFollowing.mockReturnValue(queryState({ data: [] }));
    renderScreen(<FollowersScreen />, { routeParams, routeName: 'Followers' });
    expect(
      screen.getByText(i18n.t('profile.couldNotLoadConnections', "Couldn't load list")),
    ).toBeTruthy();
  });

  it('shows the empty state when there are no followers', () => {
    mockUseFollowers.mockReturnValue(queryState({ data: [] }));
    mockUseFollowing.mockReturnValue(queryState({ data: [] }));
    renderScreen(<FollowersScreen />, { routeParams, routeName: 'Followers' });
    expect(screen.getByText(i18n.t('profile.noFollowers', 'No followers yet'))).toBeTruthy();
  });

  it('renders the loaded users and follows when the Follow button is pressed', () => {
    const follow = mutationState();
    mockUseFollow.mockReturnValue(follow);
    mockUseFollowers.mockReturnValue(
      queryState({ data: [makeUser({ id: 'u1', isFollowedByMe: false })] }),
    );
    mockUseFollowing.mockReturnValue(queryState({ data: [] }));
    renderScreen(<FollowersScreen />, { routeParams, routeName: 'Followers' });

    expect(screen.getByText('Jane Doe')).toBeTruthy();
    expect(screen.getByText('@janedoe')).toBeTruthy();

    fireEvent.press(screen.getByText(i18n.t('profile.follow', 'Follow')));
    expect(follow.mutate).toHaveBeenCalledWith(
      'u1',
      expect.objectContaining({ onError: expect.any(Function) }),
    );
  });

  it('goes back when the back button is pressed', async () => {
    mockUseFollowers.mockReturnValue(queryState({ data: [] }));
    mockUseFollowing.mockReturnValue(queryState({ data: [] }));
    const { navigation } = renderScreen(<FollowersScreen />, {
      routeParams,
      routeName: 'Followers',
    });
    fireEvent.press(screen.getByLabelText(i18n.t('common.back', 'Back')));
    await waitFor(() => expect(navigation.goBack).toHaveBeenCalled());
  });
});
