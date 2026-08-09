/**
 * Render test for ChatDetailScreen (a 1:1 thread). Mounts with a conversation +
 * messages seeded so the thread renders (not the loader), then exercises the
 * header back button (→ goBack), a private call (→ closed two-person Room),
 * the remaining "coming soon" actions, the emoji quick-insert (mutates the
 * draft → reveals send), and the send button after typing.
 */
import React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, waitFor } from '@testing-library/react-native';
import { messageKeys, MESSAGES_PAGE_SIZE } from '../../hooks/useMessages';
import { renderScreen, mockAuthenticated, resetAuth } from '../../../../test-utils/renderScreen';
import { messageService } from '../../services/messageService';
import { roomService } from '../../../rooms/services/roomService';
import { ROOM_TITLE_MAX } from '../../../rooms/constants';
import { toast } from '../../../../shared/components/Toast';
import * as socketClient from '../../../../shared/services/realtime/socketClient';
import { peerPresenceKey } from '../../../extensions/hooks/usePeerPresence';
import type { Conversation, Message, Room } from '../../../../shared/types/domain';
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

const renderChat = (conversationData: Conversation = conversation()) =>
  renderScreen(<ChatDetailScreen />, {
    route: { name: 'ChatDetail', params: { conversationId: PEER_ID } },
    seedQueryData: [
      { key: [...messageKeys.conversation(PEER_ID)], data: conversationData },
      { key: [...messageKeys.messages(PEER_ID)], data: seededThread(messages()) },
      {
        key: [...peerPresenceKey(PEER_ID)],
        data: { visible: true, isOnline: true, lastSeenAt: new Date().toISOString() },
      },
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
    const { getByText, getByTestId } = renderChat();
    await waitFor(() => {
      expect(getByText('Alice')).toBeTruthy();
    });
    expect(getByText('Hey there')).toBeTruthy();
    expect(getByTestId('chat-peer-online-dot')).toBeTruthy();
  });

  it('header back button calls navigation.goBack', () => {
    const { navigation, getByLabelText } = renderChat();
    fireEvent.press(getByLabelText('Back'));
    expect(navigation.goBack).toHaveBeenCalledTimes(1);
  });

  it('creates one closed two-person room and opens it when starting a private call', async () => {
    let resolveRoom: ((room: Room) => void) | undefined;
    const pendingRoom = new Promise<Room>(resolve => {
      resolveRoom = resolve;
    });
    const createSpy = jest.spyOn(roomService, 'create').mockReturnValue(pendingRoom);
    const { navigation, getByLabelText } = renderChat();

    fireEvent.press(getByLabelText('Call'));

    await waitFor(() => {
      expect(createSpy).toHaveBeenCalledWith({
        title: 'Private call with Alice',
        visibility: 'closed',
        topics: [],
        coHostIds: [PEER_ID],
        chatEnabled: false,
        recordingEnabled: false,
        maxSpeakers: 2,
      });
    });

    const busyCallButton = getByLabelText('Call');
    expect(busyCallButton.props.accessibilityState).toEqual({ busy: true, disabled: true });
    fireEvent.press(busyCallButton);
    expect(createSpy).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveRoom?.({ id: 'private-call-room-1' } as Room);
      await pendingRoom;
    });

    expect(navigation.navigate).toHaveBeenCalledWith('Main', {
      screen: 'RoomsTab',
      params: { screen: 'Room', params: { roomId: 'private-call-room-1' } },
    });
  });

  it('caps a private-call title built from a long profile name at the room limit', async () => {
    const longNameConversation = conversation();
    longNameConversation.participants[0] = {
      ...longNameConversation.participants[0]!,
      displayName: 'A'.repeat(ROOM_TITLE_MAX * 2),
    };
    const createSpy = jest
      .spyOn(roomService, 'create')
      .mockResolvedValue({ id: 'long-name-room' } as Room);
    const { getByLabelText } = renderChat(longNameConversation);

    fireEvent.press(getByLabelText('Call'));

    await waitFor(() => expect(createSpy).toHaveBeenCalledTimes(1));
    expect(createSpy.mock.calls[0]![0].title).toHaveLength(ROOM_TITLE_MAX);
    expect(createSpy.mock.calls[0]![0].title).toMatch(/^Private call with /);
  });

  it('reports call creation failures, unlocks the action and allows a retry', async () => {
    const createSpy = jest
      .spyOn(roomService, 'create')
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ id: 'retry-call-room' } as Room);
    const toastSpy = jest.spyOn(toast, 'error').mockReturnValue('call-error-toast');
    const { navigation, getByLabelText } = renderChat();

    fireEvent.press(getByLabelText('Call'));

    await waitFor(() => expect(toastSpy).toHaveBeenCalledTimes(1));
    expect(navigation.navigate).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(getByLabelText('Call').props.accessibilityState).toEqual({
        busy: false,
        disabled: false,
      });
    });

    fireEvent.press(getByLabelText('Call'));

    await waitFor(() => expect(createSpy).toHaveBeenCalledTimes(2));
    await waitFor(() => {
      expect(navigation.navigate).toHaveBeenCalledWith('Main', {
        screen: 'RoomsTab',
        params: { screen: 'Room', params: { roomId: 'retry-call-room' } },
      });
    });
  });

  it('more header button surfaces a "coming soon" Alert (no crash)', () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const { getByLabelText } = renderChat();
    fireEvent.press(getByLabelText('More options'));
    expect(alertSpy).toHaveBeenCalledTimes(1);
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

  it('long-pressing a received DM reports that individual message', async () => {
    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const reportSpy = jest
      .spyOn(messageService, 'report')
      .mockResolvedValue({ reportId: 'report-1', alreadyReported: false });
    const { getByText } = renderChat();

    fireEvent(getByText('Hey there'), 'longPress');
    fireEvent.press(await waitFor(() => getByText('Harassment or abuse')));

    await waitFor(() => expect(reportSpy).toHaveBeenCalledWith('m1', 'harassment'));
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
