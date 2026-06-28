/**
 * Render test for NewMessageScreen (the people picker that opens a 1:1 thread or
 * creates a group). The picker is scoped to who you follow (the DM follow-gate),
 * so we seed the `useFollowing` cache rather than mocking a global search.
 * Mounts, asserts the no-following empty state, exercises close (→ goBack),
 * filters the list, and selects one / two followed people to assert the CTA
 * `replace`s into ChatDetail or switches to the group-create label.
 */
import React from 'react';
import { fireEvent } from '@testing-library/react-native';
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

const renderNew = (following: User[]) =>
  renderScreen(<NewMessageScreen />, {
    route: { name: 'NewMessage' },
    seedQueryData: [{ key: [...profileKeys.following(ME)], data: following }],
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
});
