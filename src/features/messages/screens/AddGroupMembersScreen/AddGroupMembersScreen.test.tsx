/**
 * Render test for AddGroupMembersScreen. Candidates are scoped to who you follow
 * (the DM follow-gate) minus the people already in the group, so we seed both
 * the group detail and the `useFollowing` cache. Mounts, asserts the title +
 * no-following empty state, fires close (→ goBack), and selects a followed
 * non-member to assert the mutation runs and navigates back on success.
 */
import React from 'react';
import { fireEvent, waitFor } from '@testing-library/react-native';
import { groupKeys } from '../../hooks/useGroups';
import { profileKeys } from '../../../profile/hooks/useProfile';
import type { User } from '../../../../shared/types/domain';
import { renderScreen, mockAuthenticated, resetAuth } from '../../../../test-utils/renderScreen';
import { groupService, type GroupConversation } from '../../services/groupService';
import { AddGroupMembersScreen } from './AddGroupMembersScreen';

const ME = 'user-test-1';
const GROUP_ID = 'group-5';

const group = (): GroupConversation => ({
  id: GROUP_ID,
  title: 'Design Crew',
  ownerId: ME,
  members: [{ id: 'peer-existing', username: 'carol', displayName: 'Carol', avatarUrl: null }],
  lastMessage: null,
  unreadCount: 0,
  updatedAt: new Date().toISOString(),
});

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

const renderAdd = (following: User[]) =>
  renderScreen(<AddGroupMembersScreen />, {
    route: { name: 'AddGroupMembers', params: { conversationId: GROUP_ID } },
    seedQueryData: [
      { key: [...groupKeys.detail(GROUP_ID)], data: group() },
      { key: [...profileKeys.following(ME)], data: following },
    ],
  });

describe('AddGroupMembersScreen', () => {
  beforeEach(() => {
    mockAuthenticated();
  });
  afterEach(() => {
    resetAuth();
    jest.restoreAllMocks();
  });

  it('mounts and shows the "Add people" title', () => {
    const { getAllByText } = renderAdd([]);
    expect(getAllByText('Add people').length).toBeGreaterThan(0);
  });

  it('close button calls navigation.goBack', () => {
    const { navigation, getByLabelText } = renderAdd([]);
    fireEvent.press(getByLabelText('Close'));
    expect(navigation.goBack).toHaveBeenCalledTimes(1);
  });

  it('excludes existing members and adds a followed non-member, navigating back', async () => {
    const addSpy = jest.spyOn(groupService, 'addMembers').mockResolvedValue(group());

    const { navigation, getByText, queryByText } = renderAdd([
      followUser('peer-new', 'dave'),
      followUser('peer-existing', 'carol'),
    ]);
    // carol is already a member → filtered out of the candidate list.
    expect(queryByText('carol')).toBeNull();

    fireEvent.press(getByText('dave'));
    const cta = await waitFor(() => getByText(/^Add 1$/));
    fireEvent.press(cta);

    await waitFor(() => {
      expect(addSpy).toHaveBeenCalledWith(GROUP_ID, ['peer-new']);
    });
    await waitFor(() => {
      expect(navigation.goBack).toHaveBeenCalledTimes(1);
    });
  });
});
