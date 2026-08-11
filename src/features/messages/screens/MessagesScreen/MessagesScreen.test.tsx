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
import { presenceAvailableKey } from '../../../extensions/hooks/usePresenceAvailable';
import { renderScreen, mockAuthenticated, resetAuth } from '../../../../test-utils/renderScreen';
import type { Conversation } from '../../../../shared/types/domain';
import type { GroupConversation } from '../../services/groupService';
import { messageService } from '../../services/messageService';
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

const seededConversations = (items: Conversation[], nextCursor: string | null = null) => ({
  pages: [{ items, nextCursor }],
  pageParams: [undefined],
});

describe('MessagesScreen', () => {
  beforeEach(() => {
    mockAuthenticated();
  });
  afterEach(() => {
    jest.restoreAllMocks();
    resetAuth();
  });

  it('mounts and shows a seeded conversation + group row', async () => {
    const { getByText, getByLabelText } = renderScreen(<MessagesScreen />, {
      route: { name: 'MessagesList' },
      seedQueryData: [
        { key: [...messageKeys.conversations()], data: seededConversations([conversation()]) },
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
      seedQueryData: [{ key: [...messageKeys.conversations()], data: seededConversations([]) }],
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
        { key: [...messageKeys.conversations()], data: seededConversations([conversation()]) },
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
        { key: [...messageKeys.conversations()], data: seededConversations([]) },
        { key: [...groupKeys.list()], data: [group()] },
      ],
    });
    const row = await waitFor(() => getByLabelText('Open group Design Crew'));
    fireEvent.press(row);
    expect(navigation.navigate).toHaveBeenCalledWith('GroupChat', { conversationId: 'group-1' });
  });

  it('renders the "online now" strip and opens a DM with the exact backend peer id', async () => {
    const { navigation, getByLabelText, queryByLabelText } = renderScreen(<MessagesScreen />, {
      route: { name: 'MessagesList' },
      seedQueryData: [
        { key: [...messageKeys.conversations()], data: seededConversations([]) },
        { key: [...groupKeys.list()], data: [] },
        {
          key: [...presenceAvailableKey(20)],
          data: [
            {
              id: 'usr_backend_9',
              username: 'nina',
              displayName: 'Nina',
              avatarUrl: null,
              lastSeenAt: null,
              isOnline: true,
            },
            // Duplicate and malformed API rows must not create ambiguous or
            // broken navigation targets.
            {
              id: 'usr_backend_9',
              username: 'duplicate',
              displayName: 'Duplicate Nina',
              avatarUrl: null,
              lastSeenAt: null,
              isOnline: true,
            },
            {
              id: '   ',
              username: 'invalid',
              displayName: 'Invalid Peer',
              avatarUrl: null,
              lastSeenAt: null,
              isOnline: true,
            },
          ],
        },
      ],
    });
    const online = await waitFor(() => getByLabelText('Open chat with Nina'));
    expect(online.props.accessibilityHint).toBe('This person is currently available to chat.');
    expect(queryByLabelText('Open chat with Duplicate Nina')).toBeNull();
    expect(queryByLabelText('Open chat with Invalid Peer')).toBeNull();
    fireEvent.press(online);
    expect(navigation.navigate).toHaveBeenCalledWith('ChatDetail', {
      conversationId: 'usr_backend_9',
    });
  });

  it('loads the next conversation page when the list reaches its end', async () => {
    const alice = conversation();
    const bob = conversation({
      id: 'peer-2',
      participants: [{ id: 'peer-2', username: 'bob', displayName: 'Bob', avatarUrl: null }],
      lastMessage: {
        ...conversation().lastMessage!,
        id: 'message-bob',
        conversationId: 'peer-2',
        authorId: 'peer-2',
        text: 'Second page',
      },
    });
    const service = jest
      .spyOn(messageService, 'conversations')
      .mockResolvedValueOnce({ items: [alice], nextCursor: 'v1.page-two' })
      .mockResolvedValueOnce({ items: [bob], nextCursor: null });
    const { getByTestId, getByText } = renderScreen(<MessagesScreen />, {
      route: { name: 'MessagesList' },
      seedQueryData: [{ key: [...groupKeys.list()], data: [] }],
    });

    expect(await waitFor(() => getByText('Alice'))).toBeTruthy();
    fireEvent(getByTestId('messages-list'), 'onEndReached');
    expect(await waitFor(() => getByText('Bob'))).toBeTruthy();
    expect(service).toHaveBeenNthCalledWith(2, 'v1.page-two');
  });
});
