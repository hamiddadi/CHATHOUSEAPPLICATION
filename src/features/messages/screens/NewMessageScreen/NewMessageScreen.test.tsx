/**
 * Render test for NewMessageScreen (the people picker that opens a 1:1 thread or
 * creates a group). The picker is scoped to who you follow (the DM follow-gate),
 * so we seed the `useFollowing` cache rather than mocking a global search.
 * Mounts, asserts the no-following empty state, exercises close (→ goBack),
 * filters the list, and selects one / two followed people to assert the CTA
 * `replace`s into ChatDetail or switches to the group-create label.
 */
import React from 'react';
import { fireEvent, waitFor } from '@testing-library/react-native';
import { profileKeys } from '../../../profile/hooks/useProfile';
import type { User } from '../../../../shared/types/domain';
import { renderScreen, mockAuthenticated, resetAuth } from '../../../../test-utils/renderScreen';
import { NewMessageScreen } from './NewMessageScreen';

const ME = 'user-test-1';

const followUser = (id: string, username: string): User =>
  ({
    id,
    username,
    displayName: username,
    firstName: null,
    lastName: null,
    avatarUrl: null,
    bio: null,
    twitter: null,
    instagram: null,
    isOnline: false,
    createdAt: new Date(0).toISOString(),
    followersCount: 0,
    followingCount: 0,
    isFollowedByMe: true,
    invitedBy: null,
    currentRoomId: null,
  }) as User;

// useFollowing is now a useInfiniteQuery → the cache holds
// { pages: FollowPage[], pageParams }, not a flat User[].
const page = (following: User[]) => ({
  pages: [{ items: following, nextCursor: null }],
  pageParams: [undefined],
});

const renderNew = (following: User[]) =>
  renderScreen(<NewMessageScreen />, {
    route: { name: 'NewMessage' },
    seedQueryData: [{ key: [...profileKeys.following(ME)], data: page(following) }],
  });

describe('NewMessageScreen', () => {
  beforeEach(() => {
    mockAuthenticated();
  });
  afterEach(() => {
    resetAuth();
    jest.restoreAllMocks();
  });

  it('shows the no-following empty state when you follow no one', () => {
    const { getAllByText, getByText } = renderNew([]);
    // Header title still renders; the body explains there is no one to message.
    expect(getAllByText('New message').length).toBeGreaterThan(0);
    expect(getByText('No one to message yet')).toBeTruthy();
  });

  it('close button calls navigation.goBack', () => {
    const { navigation, getByLabelText } = renderNew([]);
    fireEvent.press(getByLabelText('Close'));
    expect(navigation.goBack).toHaveBeenCalledTimes(1);
  });

  it('selecting one followed person and pressing Message replaces into ChatDetail', () => {
    const { navigation, getByText, getByLabelText } = renderNew([
      followUser('peer-42', 'alice'),
      followUser('peer-43', 'bob'),
    ]);
    fireEvent.press(getByLabelText('alice'));
    // Single selection → CTA label is "Message".
    fireEvent.press(getByText('Message'));
    expect(navigation.replace).toHaveBeenCalledWith('ChatDetail', { conversationId: 'peer-42' });
  });

  it('selecting two people shows a group CTA (create group label)', () => {
    const { getByText, getByLabelText } = renderNew([
      followUser('peer-42', 'alice'),
      followUser('peer-43', 'bob'),
    ]);
    fireEvent.press(getByLabelText('alice'));
    fireEvent.press(getByLabelText('bob'));
    expect(getByText(/create group/i)).toBeTruthy();
  });

  it('filters the following list by the query', () => {
    const { getByPlaceholderText, getByLabelText, queryByLabelText } = renderNew([
      followUser('peer-42', 'alice'),
      followUser('peer-43', 'bob'),
    ]);
    fireEvent.changeText(getByPlaceholderText('Filter people you follow'), 'ali');
    expect(getByLabelText('alice')).toBeTruthy();
    expect(queryByLabelText('bob')).toBeNull();
  });

  it('keeps a selection visible as a chip even when the filter hides its row', () => {
    const { getByPlaceholderText, getByLabelText } = renderNew([
      followUser('peer-42', 'alice'),
      followUser('peer-43', 'bob'),
    ]);
    // Select alice, then filter to "bob" so alice's list row is hidden.
    fireEvent.press(getByLabelText('alice'));
    fireEvent.changeText(getByPlaceholderText('Filter people you follow'), 'bob');
    // The chip keeps the selection visible + removable.
    expect(getByLabelText('Remove alice')).toBeTruthy();
  });

  it('removing a chip deselects the person (CTA disappears)', () => {
    const { getByLabelText, queryByText } = renderNew([followUser('peer-42', 'alice')]);
    fireEvent.press(getByLabelText('alice'));
    // One selection → the Message CTA is shown.
    expect(queryByText('Message')).toBeTruthy();
    // Removing the only chip clears the selection → the CTA is gone.
    fireEvent.press(getByLabelText('Remove alice'));
    expect(queryByText('Message')).toBeNull();
  });

  it('loads the next page of followees when the list end is reached', async () => {
    const { profileService } = require('../../../profile/services/profileService');
    const spy = jest
      .spyOn(profileService, 'following')
      .mockResolvedValue({ items: [followUser('peer-99', 'zoe')], nextCursor: null });

    const { UNSAFE_getByType } = renderScreen(<NewMessageScreen />, {
      route: { name: 'NewMessage' },
      seedQueryData: [
        {
          key: [...profileKeys.following(ME)],
          data: {
            pages: [{ items: [followUser('peer-42', 'alice')], nextCursor: 'cursor-1' }],
            pageParams: [undefined],
          },
        },
      ],
    });

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { FlatList } = require('react-native');
    UNSAFE_getByType(FlatList).props.onEndReached();

    await waitFor(() => {
      expect(spy).toHaveBeenCalledWith(ME, 'cursor-1');
    });
    // Assert against the list data (FlatList windowing may skip the new row).
    await waitFor(() => {
      const data = UNSAFE_getByType(FlatList).props.data as User[];
      expect(data.some(u => u.id === 'peer-99')).toBe(true);
    });
  });
});
