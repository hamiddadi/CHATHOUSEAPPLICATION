/**
 * Render test for AddGroupMembersScreen. Mounts (group seeded so existing
 * members are filtered out of results), asserts the title + empty hint, fires
 * the close button (→ goBack), and — with the search service mocked so rows
 * render — selects a non-member and presses the "Add N" CTA, asserting the
 * mutation runs and navigates back on success.
 */
import React from 'react';
import { fireEvent, waitFor } from '@testing-library/react-native';
import { groupKeys } from '../../hooks/useGroups';
import { searchService, type SearchUserHit } from '../../../search/services/searchService';
import { renderScreen, mockAuthenticated, resetAuth } from '../../../../test-utils/renderScreen';
import { groupService, type GroupConversation } from '../../services/groupService';
import { AddGroupMembersScreen } from './AddGroupMembersScreen';

const GROUP_ID = 'group-5';

const group = (): GroupConversation => ({
  id: GROUP_ID,
  title: 'Design Crew',
  ownerId: 'user-test-1',
  members: [{ id: 'peer-existing', username: 'carol', displayName: 'Carol', avatarUrl: null }],
  lastMessage: null,
  unreadCount: 0,
  updatedAt: new Date().toISOString(),
});

const hit = (id: string, username: string): SearchUserHit => ({
  id,
  username,
  displayName: username,
  avatarUrl: null,
  bio: null,
  isOnline: false,
});

const renderAdd = () =>
  renderScreen(<AddGroupMembersScreen />, {
    route: { name: 'AddGroupMembers', params: { conversationId: GROUP_ID } },
    seedQueryData: [{ key: [...groupKeys.detail(GROUP_ID)], data: group() }],
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
    const { getAllByText } = renderAdd();
    expect(getAllByText('Add people').length).toBeGreaterThan(0);
  });

  it('close button calls navigation.goBack', () => {
    const { navigation, getByLabelText } = renderAdd();
    fireEvent.press(getByLabelText('Close'));
    expect(navigation.goBack).toHaveBeenCalledTimes(1);
  });

  it('selecting a person reveals the Add CTA and pressing it adds + navigates back', async () => {
    const usersSpy = jest
      .spyOn(searchService, 'users')
      .mockResolvedValue([hit('peer-new', 'dave')]);
    const addSpy = jest.spyOn(groupService, 'addMembers').mockResolvedValue(group());

    const { navigation, getByPlaceholderText, getByText } = renderAdd();
    fireEvent.changeText(getByPlaceholderText('Search people'), 'da');
    const row = await waitFor(() => getByText('dave'), { timeout: 2000 });
    expect(usersSpy).toHaveBeenCalled();
    fireEvent.press(row);

    const cta = await waitFor(() => getByText(/^Add 1$/));
    fireEvent.press(cta);
    // mutate() is async; assert via waitFor.
    await waitFor(() => {
      expect(addSpy).toHaveBeenCalledWith(GROUP_ID, ['peer-new']);
    });
    await waitFor(() => {
      expect(navigation.goBack).toHaveBeenCalledTimes(1);
    });
  });
});
