/**
 * Render test for ChatDetailScreen (a 1:1 thread). Mounts with a conversation +
 * messages seeded so the thread renders (not the loader), then exercises the
 * header back button (→ goBack), the call/more buttons (→ "coming soon" Alert,
 * not a crash), the emoji quick-insert (mutates the draft → reveals send), and
 * the send button after typing.
 */
import React from 'react';
import { Alert } from 'react-native';
import { fireEvent, waitFor } from '@testing-library/react-native';
import { messageKeys, MESSAGES_PAGE_SIZE } from '../../hooks/useMessages';
import { renderScreen, mockAuthenticated, resetAuth } from '../../../../test-utils/renderScreen';
import { messageService } from '../../services/messageService';
import * as socketClient from '../../../../shared/services/realtime/socketClient';
import type { Conversation, Message } from '../../../../shared/types/domain';
import { ChatDetailScreen } from './ChatDetailScreen';

const PEER_ID = 'peer-9';

const conversation = (): Conversation => ({
  id: PEER_ID,
  participants: [
    { id: PEER_ID, username: 'alice', displayName: 'Alice', avatarUrl: null },
    { id: 'user-test-1', username: 'tester', displayName: 'Test User', avatarUrl: null },
  ],
  lastMessage: null,
  unreadCount: 0,
  updatedAt: new Date().toISOString(),
});

const messages = (): Message[] => [
  {
    id: 'm1',
    conversationId: PEER_ID,
    authorId: PEER_ID,
    text: 'Hey there',
    kind: 'text',
    audioUrl: null,
    durationMs: null,
    sentAt: new Date().toISOString(),
    isMine: false,
  },
];

// The thread is now a useInfiniteQuery, so its cache is InfiniteData (pages +
// pageParams), not a flat array. Wrap a single ascending page as page 0.
const seededThread = (msgs: Message[]) => ({
  pages: [msgs],
  pageParams: [undefined],
});

const renderChat = () =>
  renderScreen(<ChatDetailScreen />, {
    route: { name: 'ChatDetail', params: { conversationId: PEER_ID } },
    seedQueryData: [
      { key: [...messageKeys.conversation(PEER_ID)], data: conversation() },
      { key: [...messageKeys.messages(PEER_ID)], data: seededThread(messages()) },
    ],
  });

describe('ChatDetailScreen', () => {
  beforeEach(() => {
    mockAuthenticated();
  });
  afterEach(() => {
    resetAuth();
    jest.restoreAllMocks();
  });

  it('mounts and renders the peer name + an existing message bubble', async () => {
    const { getByText } = renderChat();
    await waitFor(() => {
      expect(getByText('Alice')).toBeTruthy();
    });
    expect(getByText('Hey there')).toBeTruthy();
  });

  it('header back button calls navigation.goBack', () => {
    const { navigation, getByLabelText } = renderChat();
    fireEvent.press(getByLabelText('Back'));
    expect(navigation.goBack).toHaveBeenCalledTimes(1);
  });

  it('call + more header buttons surface a "coming soon" Alert (no crash)', () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const { getByLabelText } = renderChat();
    fireEvent.press(getByLabelText('Call'));
    fireEvent.press(getByLabelText('More options'));
    expect(alertSpy).toHaveBeenCalledTimes(2);
  });

  it('emoji button opens the palette; picking an emoji reveals the send button', async () => {
    const { getByLabelText, queryByLabelText } = renderChat();
    // With an empty draft the mic button shows; send is hidden.
    expect(queryByLabelText('Send message')).toBeNull();
    // Tapping the emoji button now toggles a quick-pick palette (no longer
    // appends a single hardcoded emoji); picking one fills the draft.
    fireEvent.press(getByLabelText('Insert emoji'));
    fireEvent.press(getByLabelText('🔥'));
    await waitFor(() => {
      expect(getByLabelText('Send message')).toBeTruthy();
    });
  });

  it('typing then pressing send waits for the message mutation', async () => {
    const sent: Message = {
      ...messages()[0]!,
      id: 'm-sent',
      authorId: 'user-test-1',
      text: 'Hello world',
      isMine: true,
    };
    const sendSpy = jest.spyOn(messageService, 'send').mockResolvedValue(sent);
    const { getByLabelText, getByPlaceholderText } = renderChat();
    fireEvent.changeText(getByPlaceholderText('Type a message…'), 'Hello world');
    const send = await waitFor(() => getByLabelText('Send message'));
    fireEvent.press(send);
    await waitFor(() => {
      expect(sendSpy).toHaveBeenCalledWith(PEER_ID, 'Hello world');
    });
  });

  it('attach button surfaces a "coming soon" Alert (no crash)', () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const { getByLabelText } = renderChat();
    fireEvent.press(getByLabelText('Attach file'));
    expect(alertSpy).toHaveBeenCalledTimes(1);
  });

  it('shows an error state with a working Retry when the thread fails to load', async () => {
    // No seeded thread + a rejecting service → the query enters isError.
    const messagesSpy = jest
      .spyOn(messageService, 'messages')
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce([]);
    const { getByText } = renderScreen(<ChatDetailScreen />, {
      route: { name: 'ChatDetail', params: { conversationId: PEER_ID } },
      seedQueryData: [{ key: [...messageKeys.conversation(PEER_ID)], data: conversation() }],
    });
    await waitFor(() => {
      // Copy is fully localized via t(); the test harness runs in English
      // (react-native-localize mock → 'en'), so the error title resolves to the
      // en.json value (chat.loadErrorTitle), not the French inline default.
      expect(getByText("Couldn't load messages")).toBeTruthy();
    });
    // Retry re-runs the query (second call resolves) → error clears. The
    // EmptyState action button renders its label as child text (no a11y label).
    fireEvent.press(getByText('Retry'));
    await waitFor(() => expect(messagesSpy).toHaveBeenCalledTimes(2));
    messagesSpy.mockRestore();
  });

  it('shows a "new chat" empty state when the thread is empty', async () => {
    const messagesSpy = jest.spyOn(messageService, 'messages').mockResolvedValue([]);
    const { getByText } = renderScreen(<ChatDetailScreen />, {
      route: { name: 'ChatDetail', params: { conversationId: PEER_ID } },
      seedQueryData: [{ key: [...messageKeys.conversation(PEER_ID)], data: conversation() }],
    });
    await waitFor(() => {
      // Localized via t(); harness language is English (localize mock → 'en'),
      // so the empty-state title resolves to the en.json value (chat.emptyTitle).
      expect(getByText('No messages yet')).toBeTruthy();
    });
    messagesSpy.mockRestore();
  });

  it('reaching the top of the inverted list loads the next (older) page', async () => {
    const fullPage: Message[] = Array.from({ length: MESSAGES_PAGE_SIZE }, (_, i) => ({
      id: `p1-${i}`,
      conversationId: PEER_ID,
      authorId: PEER_ID,
      text: `msg ${i}`,
      kind: 'text' as const,
      audioUrl: null,
      durationMs: null,
      sentAt: new Date(Date.now() - i * 1000).toISOString(),
      isMine: false,
    }));
    const olderPage: Message[] = [
      {
        id: 'older-1',
        conversationId: PEER_ID,
        authorId: PEER_ID,
        text: 'the oldest message',
        kind: 'text',
        audioUrl: null,
        durationMs: null,
        sentAt: new Date(Date.now() - 999_999).toISOString(),
        isMine: false,
      },
    ];
    const messagesSpy = jest
      .spyOn(messageService, 'messages')
      .mockResolvedValueOnce(fullPage)
      .mockResolvedValueOnce(olderPage);
    const { getByTestId } = renderScreen(<ChatDetailScreen />, {
      route: { name: 'ChatDetail', params: { conversationId: PEER_ID } },
      seedQueryData: [{ key: [...messageKeys.conversation(PEER_ID)], data: conversation() }],
    });
    const list = await waitFor(() => getByTestId('chat-thread-list'));
    await waitFor(() => expect(messagesSpy).toHaveBeenCalledTimes(1));
    fireEvent(list, 'onEndReached');
    await waitFor(() => expect(messagesSpy).toHaveBeenCalledTimes(2));
    expect(messagesSpy.mock.calls[1]![1]).toEqual(
      expect.objectContaining({ before: expect.any(String) }),
    );
    messagesSpy.mockRestore();
  });

  it('mounts the chat socket (subscribes to chat:message) regardless of entry point', async () => {
    const on = jest.fn();
    const off = jest.fn();
    const fakeSocket = { on, off } as unknown as Awaited<ReturnType<typeof socketClient.getSocket>>;
    const getSocketSpy = jest.spyOn(socketClient, 'getSocket').mockResolvedValue(fakeSocket);
    renderChat();
    await waitFor(() => {
      expect(getSocketSpy).toHaveBeenCalled();
      expect(on).toHaveBeenCalledWith('chat:message', expect.any(Function));
    });
    getSocketSpy.mockRestore();
  });
});
