/**
 * Render test for GroupInfoScreen. Seeds the group detail so it skips the
 * full-screen loader, asserts the members render, and exercises the primary
 * controls: back (→ goBack), "Add people" (→ AddGroupMembers), "Leave group"
 * (→ Alert with a destructive action), removing a member (→ Alert, owner-only),
 * and the rename Save button.
 */
import React from 'react';
import { Alert } from 'react-native';
import { fireEvent, waitFor } from '@testing-library/react-native';
import { groupKeys } from '../../hooks/useGroups';
import { renderScreen, mockAuthenticated, resetAuth } from '../../../../test-utils/renderScreen';
import type { GroupConversation } from '../../services/groupService';
import { GroupInfoScreen } from './GroupInfoScreen';

const GROUP_ID = 'group-3';

// Owner === the authenticated user (user-test-1) so the owner-only controls
// (remove member) render.
const group = (): GroupConversation => ({
  id: GROUP_ID,
  title: 'Design Crew',
  ownerId: 'user-test-1',
  members: [
    { id: 'user-test-1', username: 'tester', displayName: 'Test User', avatarUrl: null },
    { id: 'peer-2', username: 'bob', displayName: 'Bob', avatarUrl: null },
  ],
  lastMessage: null,
  unreadCount: 0,
  updatedAt: new Date().toISOString(),
});

const renderInfo = () =>
  renderScreen(<GroupInfoScreen />, {
    route: { name: 'GroupInfo', params: { conversationId: GROUP_ID } },
    seedQueryData: [{ key: [...groupKeys.detail(GROUP_ID)], data: group() }],
  });

describe('GroupInfoScreen', () => {
  beforeEach(() => {
    mockAuthenticated();
  });
  afterEach(() => {
    resetAuth();
    jest.restoreAllMocks();
  });

  it('mounts and renders members', async () => {
    const { getByText } = renderInfo();
    await waitFor(() => {
      expect(getByText('Bob')).toBeTruthy();
    });
    // The current user row carries the "(you)" suffix.
    expect(getByText(/Test User/)).toBeTruthy();
  });

  it('Add people button navigates to AddGroupMembers', async () => {
    const { navigation, getByText } = renderInfo();
    fireEvent.press(await waitFor(() => getByText('Add people')));
    expect(navigation.navigate).toHaveBeenCalledWith('AddGroupMembers', {
      conversationId: GROUP_ID,
    });
  });

  it('Leave group opens a confirmation Alert', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const { getByText } = renderInfo();
    fireEvent.press(await waitFor(() => getByText('Leave group')));
    expect(alertSpy).toHaveBeenCalledTimes(1);
  });

  it('Leave group → confirming popToTops after the leave settles', async () => {
    // Drive the Alert by invoking the destructive button's onPress.
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((_title, _msg, buttons) => {
      const confirm = buttons?.find(b => b.style === 'destructive');
      confirm?.onPress?.();
    });
    const { navigation, getByText } = renderInfo();
    fireEvent.press(await waitFor(() => getByText('Leave group')));
    expect(alertSpy).toHaveBeenCalled();
    // leave.mutate fires against the unmocked apiClient (rejects); onSettled runs
    // either way → popToTop. Allow the rejected promise to settle.
    await waitFor(() => {
      expect(navigation.popToTop).toHaveBeenCalledTimes(1);
    });
  });

  it('remove-member button (owner-only) opens a confirmation Alert', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const { getByLabelText } = renderInfo();
    fireEvent.press(await waitFor(() => getByLabelText('Remove Bob')));
    expect(alertSpy).toHaveBeenCalledTimes(1);
  });

  it('Save title button is reachable and safe to press after editing', async () => {
    const { getByLabelText, getByDisplayValue } = renderInfo();
    const input = await waitFor(() => getByDisplayValue('Design Crew'));
    fireEvent.changeText(input, 'Renamed Crew');
    const save = getByLabelText('Save');
    expect(() => fireEvent.press(save)).not.toThrow();
  });
});
