/**
 * Render-test for FollowersScreen. Requires `{ userId, initialTab }` route
 * params. Primes the followers/following query caches so the FlatList renders
 * real rows, then exercises the back button, the Followers/Following tab
 * toggle, and a row's Follow button.
 */
import React from 'react';
import { fireEvent } from '@testing-library/react-native';
import { profileKeys } from '../../hooks/useProfile';
import type { User } from '../../../../shared/types/domain';
import { renderScreen, mockAuthenticated, resetAuth } from '../../../../test-utils/renderScreen';
import { FollowersScreen } from './FollowersScreen';

const TARGET_ID = 'user-target-1';

const makeUser = (id: string, overrides: Partial<User> = {}): User => ({
  id,
  username: `u_${id}`,
  displayName: `User ${id}`,
  firstName: null,
  lastName: null,
  bio: null,
  avatarUrl: null,
  twitter: null,
  instagram: null,
  followersCount: 0,
  followingCount: 0,
  isFollowedByMe: false,
  isOnline: false,
  createdAt: new Date(0).toISOString(),
  invitedBy: null,
  ...overrides,
});

const followers = [makeUser('follower-a'), makeUser('follower-b')];
const following = [makeUser('following-x', { isFollowedByMe: true })];

const seed = () => [
  { key: [...profileKeys.followers(TARGET_ID)], data: followers },
  { key: [...profileKeys.following(TARGET_ID)], data: following },
];

const baseRoute = {
  name: 'Followers',
  params: { userId: TARGET_ID, initialTab: 'followers' as const },
};

describe('FollowersScreen', () => {
  beforeEach(() => {
    mockAuthenticated();
  });
  afterEach(() => {
    resetAuth();
    jest.restoreAllMocks();
  });

  it('mounts with the followers list primed and shows a follower row', () => {
    const { getByText, toJSON } = renderScreen(<FollowersScreen />, {
      route: baseRoute,
      seedQueryData: seed(),
    });
    expect(toJSON()).toBeTruthy();
    expect(getByText('@u_follower-a')).toBeTruthy();
  });

  it('back button calls navigation.goBack', () => {
    const { getByLabelText, navigation } = renderScreen(<FollowersScreen />, {
      route: baseRoute,
      seedQueryData: seed(),
    });
    fireEvent.press(getByLabelText('Back'));
    expect(navigation.goBack).toHaveBeenCalledTimes(1);
  });

  it('switching to the Following tab swaps the visible list', () => {
    const { getByText, queryByText } = renderScreen(<FollowersScreen />, {
      route: baseRoute,
      seedQueryData: seed(),
    });
    // Starts on followers.
    expect(getByText('@u_follower-a')).toBeTruthy();
    // The tab toggle Pressable wraps a "Following" label.
    fireEvent.press(getByText('Following'));
    expect(getByText('@u_following-x')).toBeTruthy();
    expect(queryByText('@u_follower-a')).toBeNull();
  });

  it('a row Follow button fires without throwing', () => {
    const { getAllByText } = renderScreen(<FollowersScreen />, {
      route: baseRoute,
      seedQueryData: seed(),
    });
    // Each non-followed follower row renders a "Follow" Button. (The tab label
    // "Following" is distinct text.) Press the first row CTA.
    const followButtons = getAllByText('Follow');
    expect(() => fireEvent.press(followButtons[0])).not.toThrow();
  });

  it('renders the empty state when a list is empty', () => {
    const { getByText } = renderScreen(<FollowersScreen />, {
      route: baseRoute,
      seedQueryData: [
        { key: [...profileKeys.followers(TARGET_ID)], data: [] },
        { key: [...profileKeys.following(TARGET_ID)], data: [] },
      ],
    });
    expect(getByText('No followers yet')).toBeTruthy();
  });
});
