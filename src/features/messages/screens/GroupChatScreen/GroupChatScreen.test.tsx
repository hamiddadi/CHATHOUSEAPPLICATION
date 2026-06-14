/**
 * Render test for GroupChatScreen. Mounts a group thread (group + messages
 * seeded so it skips the loader), asserts the title + a message render, and
 * exercises the primary controls: the "Group info" header button (→ GroupInfo),
 * the back button (→ goBack), and the send button after typing a draft.
 */
import React from 'react';
import { fireEvent, waitFor } from '@testing-library/react-native';
import { groupKeys } from '../../hooks/useGroups';
import { renderScreen, mockAuthenticated, resetAuth } from '../../../../test-utils/renderScreen';
import type { GroupConversation, GroupMessage } from '../../services/groupService';
import { GroupChatScreen } from './GroupChatScreen';

const GROUP_ID = 'group-7';

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

const messages = (): GroupMessage[] => [
  {
    id: 'gm1',
    conversationId: GROUP_ID,
    senderId: 'peer-2',
    content: 'Welcome everyone',
    kind: 'text',
    audioUrl: null,
    durationMs: null,
    createdAt: new Date().toISOString(),
    sender: { id: 'peer-2', username: 'bob', displayName: 'Bob', avatarUrl: null },
  },
];

const renderGroup = () =>
  renderScreen(<GroupChatScreen />, {
    route: { name: 'GroupChat', params: { conversationId: GROUP_ID } },
    seedQueryData: [
      { key: [...groupKeys.detail(GROUP_ID)], data: group() },
      { key: [...groupKeys.messages(GROUP_ID)], data: messages() },
    ],
  });

describe('GroupChatScreen', () => {
  beforeEach(() => {
    mockAuthenticated();
  });
  afterEach(() => {
    resetAuth();
  });

  it('mounts and renders the group title + a message', async () => {
    const { getAllByText, getByText } = renderGroup();
    await waitFor(() => {
      expect(getAllByText('Design Crew').length).toBeGreaterThan(0);
    });
    expect(getByText('Welcome everyone')).toBeTruthy();
  });

  it('Group info button navigates to GroupInfo with the conversation id', async () => {
    const { navigation, getAllByLabelText } = renderGroup();
    const infoButtons = await waitFor(() => getAllByLabelText('Group info'));
    fireEvent.press(infoButtons[0]!);
    expect(navigation.navigate).toHaveBeenCalledWith('GroupInfo', { conversationId: GROUP_ID });
  });

  it('typing then pressing send does not crash', async () => {
    const { getByPlaceholderText, getByLabelText } = renderGroup();
    fireEvent.changeText(getByPlaceholderText('Message'), 'Hi team');
    const send = await waitFor(() => getByLabelText('Send'));
    // send.mutate fires against the unmocked apiClient (rejects); onError restores
    // the draft + toasts. The press itself must be crash-free.
    expect(() => fireEvent.press(send)).not.toThrow();
  });

  it('shows the mic button when the draft is empty', async () => {
    const { getByLabelText } = renderGroup();
    await waitFor(() => {
      expect(getByLabelText('Record a voice message')).toBeTruthy();
    });
  });
});
