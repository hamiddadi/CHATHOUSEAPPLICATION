/**
 * Render test for MessagesScreen. Mounts the conversation list (seeded so it
 * skips the loader), asserts the header renders, and exercises the primary
 * CTAs: the "new chat" header button (→ NewMessage), tapping a 1:1 conversation
 * row (→ ChatDetail), and tapping a group row (→ GroupChat).
 */
import React from 'react';
import { fireEvent, waitFor } from '@testing-library/react-native';
import { messageKeys } from '../../hooks/useMessages';
import { groupKeys } from '../../hooks/useGroups';
import { renderScreen, mockAuthenticated, resetAuth } from '../../../../test-utils/renderScreen';
import type { Conversation } from '../../../../shared/types/domain';
import type { GroupConversation } from '../../services/groupService';
import { MessagesScreen } from './MessagesScreen';

const conversation = (overrides: Partial<Conversation> = {}): Conversation => ({
  id: 'peer-1',
  participants: [
    { id: 'peer-1', username: 'alice', displayName: 'Alice', avatarUrl: null },
    { id: 'user-test-1', username: 'tester', displayName: 'Test User', avatarUrl: null },
  ],
  lastMessage: {
    id: 'm1',
    conversationId: 'peer-1',
    authorId: 'peer-1',
    text: 'Hello there',
    kind: 'text',
    audioUrl: null,
    durationMs: null,
    sentAt: new Date().toISOString(),
    isMine: false,
  },
  unreadCount: 2,
  updatedAt: new Date().toISOString(),
  ...overrides,
});

const group = (overrides: Partial<GroupConversation> = {}): GroupConversation => ({
  id: 'group-1',
  title: 'Design Crew',
  ownerId: 'user-test-1',
  members: [
    { id: 'user-test-1', username: 'tester', displayName: 'Test User', avatarUrl: null },
    { id: 'peer-2', username: 'bob', displayName: 'Bob', avatarUrl: null },
  ],
  lastMessage: null,
  unreadCount: 0,
  updatedAt: new Date().toISOString(),
  ...overrides,
});

describe('MessagesScreen', () => {
  beforeEach(() => {
    mockAuthenticated();
  });
  afterEach(() => {
    resetAuth();
  });

  it('mounts and shows a seeded conversation + group row', async () => {
    const { getByText, getByLabelText } = renderScreen(<MessagesScreen />, {
      route: { name: 'MessagesList' },
      seedQueryData: [
        { key: [...messageKeys.conversations()], data: [conversation()] },
        { key: [...groupKeys.list()], data: [group()] },
      ],
    });
    await waitFor(() => {
      expect(getByText('Alice')).toBeTruthy();
    });
    expect(getByText('Design Crew')).toBeTruthy();
    // The 1:1 row + group row carry distinct a11y labels.
    expect(getByLabelText('Open chat with Alice')).toBeTruthy();
    expect(getByLabelText('Open group Design Crew')).toBeTruthy();
  });

  it('header new-chat button navigates to NewMessage', () => {
    const { navigation, getByLabelText } = renderScreen(<MessagesScreen />, {
      route: { name: 'MessagesList' },
      seedQueryData: [{ key: [...messageKeys.conversations()], data: [] }],
    });
    // accessibilityLabel resolves from i18n key messages.newChatA11y.
    const newChat = getByLabelText(/new|message|nouveau|conversation/i);
    fireEvent.press(newChat);
    expect(navigation.navigate).toHaveBeenCalledWith('NewMessage');
  });

  it('tapping a conversation row navigates to ChatDetail with the peer id', async () => {
    const { navigation, getByLabelText } = renderScreen(<MessagesScreen />, {
      route: { name: 'MessagesList' },
      seedQueryData: [
        { key: [...messageKeys.conversations()], data: [conversation()] },
        { key: [...groupKeys.list()], data: [] },
      ],
    });
    const row = await waitFor(() => getByLabelText('Open chat with Alice'));
    fireEvent.press(row);
    expect(navigation.navigate).toHaveBeenCalledWith('ChatDetail', { conversationId: 'peer-1' });
  });

  it('tapping a group row navigates to GroupChat with the group id', async () => {
    const { navigation, getByLabelText } = renderScreen(<MessagesScreen />, {
      route: { name: 'MessagesList' },
      seedQueryData: [
        { key: [...messageKeys.conversations()], data: [] },
        { key: [...groupKeys.list()], data: [group()] },
      ],
    });
    const row = await waitFor(() => getByLabelText('Open group Design Crew'));
    fireEvent.press(row);
    expect(navigation.navigate).toHaveBeenCalledWith('GroupChat', { conversationId: 'group-1' });
  });
});
