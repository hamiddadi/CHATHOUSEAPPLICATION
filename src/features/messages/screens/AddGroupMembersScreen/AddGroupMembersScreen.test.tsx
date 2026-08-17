/**
 * Render test for AddGroupMembersScreen. Candidates are scoped to who you follow
 * (the DM follow-gate) minus the people already in the group, so we seed both
 * the group detail and the `useFollowing` cache. Mounts, asserts the title +
 * no-following empty state, fires close (→ goBack), and selects a followed
 * non-member to assert the mutation runs and navigates back on success.
 */
import React from 'react';
import { act, fireEvent, waitFor } from '@testing-library/react-native';
import { groupKeys } from '../../hooks/useGroups';
import { profileKeys } from '../../../profile/hooks/useProfile';
import type { User } from '../../../../shared/types/domain';
import { renderScreen, mockAuthenticated, resetAuth } from '../../../../test-utils/renderScreen';
import { profileService } from '../../../profile/services/profileService';
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

// useFollowing is now a useInfiniteQuery → seed the paged cache shape.
const page = (following: User[]) => ({
  pages: [{ items: following, nextCursor: null, hasMore: false }],
  pageParams: [undefined],
});

const renderAdd = (following: User[]) =>
  renderScreen(<AddGroupMembersScreen />, {
    route: { name: 'AddGroupMembers', params: { conversationId: GROUP_ID } },
    seedQueryData: [
      { key: [...groupKeys.detail(GROUP_ID)], data: group() },
      { key: [...profileKeys.following(ME)], data: page(following) },
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

  it('shows a retryable error instead of an empty candidate list when loading fails', async () => {
    const followingSpy = jest
      .spyOn(profileService, 'following')
      .mockRejectedValue(new Error('offline'));
    const { findByText, getAllByText, getByText, queryByText } = renderScreen(
      <AddGroupMembersScreen />,
      {
        route: { name: 'AddGroupMembers', params: { conversationId: GROUP_ID } },
        seedQueryData: [{ key: [...groupKeys.detail(GROUP_ID)], data: group() }],
      },
    );

    expect(await findByText("Couldn't load messages")).toBeTruthy();
    expect(queryByText('No one to message yet')).toBeNull();
    expect(getAllByText('Add people').length).toBeGreaterThan(0);

    fireEvent.press(getByText('Retry'));
    await waitFor(() => expect(followingSpy).toHaveBeenCalledTimes(2));
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
      expect(addSpy).toHaveBeenCalledWith(GROUP_ID, ['peer-new'], expect.stringMatching(/^rn-/));
    });
    await waitFor(() => {
      expect(navigation.goBack).toHaveBeenCalledTimes(1);
    });
  });

  it('exposes an accessibility label on each candidate checkbox', () => {
    const { getByLabelText } = renderAdd([followUser('peer-new', 'dave')]);
    // The checkbox row is reachable by the candidate's name (aligned with
    // NewMessageScreen), so a screen reader announces who it toggles.
    const row = getByLabelText('dave');
    expect(row.props.accessibilityRole).toBe('checkbox');
  });

  it('turns a same-tick double press into one member-add mutation', async () => {
    let resolveAdd!: (value: GroupConversation) => void;
    const addSpy = jest
      .spyOn(groupService, 'addMembers')
      .mockReturnValue(new Promise(resolve => (resolveAdd = resolve)));
    const { getByText } = renderAdd([followUser('peer-new', 'dave')]);
    fireEvent.press(getByText('dave'));
    const addButton = await waitFor(() => getByText(/^Add 1$/));

    act(() => {
      fireEvent.press(addButton);
      fireEvent.press(addButton);
    });
    await waitFor(() => expect(addSpy).toHaveBeenCalledTimes(1));
    await act(async () => resolveAdd(group()));
  });

  it('keeps a selection visible as a removable chip when the filter hides its row', () => {
    const { getByLabelText, getByPlaceholderText } = renderAdd([
      followUser('peer-new', 'dave'),
      followUser('peer-eve', 'eve'),
    ]);
    fireEvent.press(getByLabelText('dave'));
    // Filter to "eve" so dave's list row is hidden — the chip must persist.
    fireEvent.changeText(getByPlaceholderText('Filter people you follow'), 'eve');
    expect(getByLabelText('Remove dave')).toBeTruthy();
  });

  it('loads the next page of candidates when the list end is reached', async () => {
    const { profileService } = require('../../../profile/services/profileService');
    const spy = jest.spyOn(profileService, 'following').mockResolvedValue({
      items: [followUser('peer-zoe', 'zoe')],
      nextCursor: null,
      hasMore: false,
    });

    const { UNSAFE_getByType } = renderScreen(<AddGroupMembersScreen />, {
      route: { name: 'AddGroupMembers', params: { conversationId: GROUP_ID } },
      seedQueryData: [
        { key: [...groupKeys.detail(GROUP_ID)], data: group() },
        {
          key: [...profileKeys.following(ME)],
          data: {
            pages: [
              {
                items: [followUser('peer-new', 'dave')],
                nextCursor: 'cursor-1',
                hasMore: true,
              },
            ],
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
      expect(data.some(u => u.id === 'peer-zoe')).toBe(true);
    });
  });
});
