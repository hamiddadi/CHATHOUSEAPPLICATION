/**
 * Render-test for FollowersScreen. Requires `{ userId, initialTab }` route
 * params. Primes the followers/following query caches so the FlatList renders
 * real rows, then exercises the back button, the Followers/Following tab
 * toggle, and a row's Follow button.
 */
import React from 'react';
import { fireEvent, waitFor } from '@testing-library/react-native';
import { profileKeys } from '../../hooks/useProfile';
import { profileService } from '../../services/profileService';
import type { User } from '../../../../shared/types/domain';
import { renderScreen, mockAuthenticated, resetAuth } from '../../../../test-utils/renderScreen';
import { FollowersScreen } from './FollowersScreen';

const TARGET_ID = 'user-target-1';
// mockAuthenticated() seeds this id as the current viewer (see renderScreen).
const ME = 'user-test-1';

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

// useFollowers/useFollowing are now useInfiniteQuery — the cache holds
// { pages: FollowPage[], pageParams } rather than a flat User[]. Wrap each
// roster as a single page with no further cursor.
const page = (items: User[]) => ({
  pages: [{ items, nextCursor: null, hasMore: false }],
  pageParams: [undefined],
});

const seed = () => [
  { key: [...profileKeys.followers(TARGET_ID)], data: page(followers) },
  { key: [...profileKeys.following(TARGET_ID)], data: page(following) },
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

  it('shows a pending private request and cancels it instead of following twice', async () => {
    const pending = makeUser('private-user', { followRequestedByMe: true });
    const unfollow = jest.spyOn(profileService, 'unfollow').mockResolvedValue({ unfollowed: true });
    jest
      .spyOn(profileService, 'followers')
      .mockResolvedValue({ items: [], nextCursor: null, hasMore: false });
    const { getByText } = renderScreen(<FollowersScreen />, {
      route: baseRoute,
      seedQueryData: [
        { key: [...profileKeys.followers(TARGET_ID)], data: page([pending]) },
        { key: [...profileKeys.following(TARGET_ID)], data: page(following) },
      ],
    });

    fireEvent.press(getByText('Requested'));
    await waitFor(() => expect(unfollow).toHaveBeenCalledWith('private-user'));
  });

  it('renders the empty state when a list is empty', () => {
    const { getByText } = renderScreen(<FollowersScreen />, {
      route: baseRoute,
      seedQueryData: [
        { key: [...profileKeys.followers(TARGET_ID)], data: page([]) },
        { key: [...profileKeys.following(TARGET_ID)], data: page([]) },
      ],
    });
    expect(getByText('No followers yet')).toBeTruthy();
  });

  it('offers a retry when the active connections query fails', async () => {
    const followersSpy = jest
      .spyOn(profileService, 'followers')
      .mockRejectedValue(new Error('offline'));
    const { findByText, getByText, queryByText } = renderScreen(<FollowersScreen />, {
      route: baseRoute,
      seedQueryData: [{ key: [...profileKeys.following(TARGET_ID)], data: page(following) }],
    });

    expect(await findByText("Couldn't load list")).toBeTruthy();
    expect(queryByText('No followers yet')).toBeNull();

    fireEvent.press(getByText('Retry'));
    await waitFor(() => expect(followersSpy).toHaveBeenCalledTimes(2));
  });

  it('hides the Follow button on my own row (no self-follow)', () => {
    // My own account appears in the followers list; its row must not offer a
    // Follow toggle (a self-follow 400s server-side).
    const withSelf = [makeUser(ME), makeUser('follower-b')];
    const { queryAllByText, getByText } = renderScreen(<FollowersScreen />, {
      route: baseRoute,
      seedQueryData: [
        { key: [...profileKeys.followers(TARGET_ID)], data: page(withSelf) },
        { key: [...profileKeys.following(TARGET_ID)], data: page(following) },
      ],
    });
    // Both rows render...
    expect(getByText(`@u_${ME}`)).toBeTruthy();
    expect(getByText('@u_follower-b')).toBeTruthy();
    // ...but only the non-self row exposes a "Follow" button.
    expect(queryAllByText('Follow')).toHaveLength(1);
  });

  it('loads the next page when the list end is reached (infinite scroll)', async () => {
    // Seed a first page that reports there IS more (nextCursor set). Reaching
    // the end must call the service with that cursor and append its rows.
    const spy = jest
      .spyOn(profileService, 'followers')
      .mockResolvedValue({ items: [makeUser('follower-c')], nextCursor: null, hasMore: false });

    const { UNSAFE_getByType } = renderScreen(<FollowersScreen />, {
      route: baseRoute,
      seedQueryData: [
        {
          key: [...profileKeys.followers(TARGET_ID)],
          data: {
            pages: [{ items: followers, nextCursor: 'cursor-1', hasMore: true }],
            pageParams: [undefined],
          },
        },
        { key: [...profileKeys.following(TARGET_ID)], data: page(following) },
      ],
    });

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { FlatList } = require('react-native');
    UNSAFE_getByType(FlatList).props.onEndReached();

    await waitFor(() => {
      expect(spy).toHaveBeenCalledWith(TARGET_ID, 'cursor-1');
    });
    // FlatList windowing may not render the appended row in jsdom, so assert
    // against the data prop directly (mirrors ExtActivityFeedScreen's test).
    await waitFor(() => {
      const data = UNSAFE_getByType(FlatList).props.data as User[];
      expect(data.some(u => u.id === 'follower-c')).toBe(true);
    });
  });
});
