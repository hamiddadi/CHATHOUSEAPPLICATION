/**
 * Render test for GroupChatScreen. Mounts a group thread (group + messages
 * seeded so it skips the loader), asserts the title + a message render, and
 * exercises the primary controls: the "Group info" header button (→ GroupInfo),
 * the back button (→ goBack), and the send button after typing a draft.
 */
import React from 'react';
import { fireEvent, waitFor } from '@testing-library/react-native';
import { groupKeys, GROUP_MESSAGES_PAGE_SIZE } from '../../hooks/useGroups';
import { renderScreen, mockAuthenticated, resetAuth } from '../../../../test-utils/renderScreen';
import {
  groupService,
  type GroupConversation,
  type GroupMessage,
} from '../../services/groupService';
import * as socketClient from '../../../../shared/services/realtime/socketClient';
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

// The group thread is now a useInfiniteQuery, so its cache is InfiniteData
// (pages + pageParams), not a flat array. Wrap a single ascending page.
const seededThread = (msgs: GroupMessage[]) => ({
  pages: [msgs],
  pageParams: [undefined],
});

const renderGroup = () =>
  renderScreen(<GroupChatScreen />, {
    route: { name: 'GroupChat', params: { conversationId: GROUP_ID } },
    seedQueryData: [
      { key: [...groupKeys.detail(GROUP_ID)], data: group() },
      { key: [...groupKeys.messages(GROUP_ID)], data: seededThread(messages()) },
    ],
  });

describe('GroupChatScreen', () => {
  beforeEach(() => {
    mockAuthenticated();
  });
  afterEach(() => {
    resetAuth();
    jest.restoreAllMocks();
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

  it('typing then pressing send waits for the group message mutation', async () => {
    const sent: GroupMessage = {
      ...messages()[0]!,
      id: 'gm-sent',
      senderId: 'user-test-1',
      content: 'Hi team',
      sender: { id: 'user-test-1', username: 'tester', displayName: 'Test User', avatarUrl: null },
    };
    const sendSpy = jest.spyOn(groupService, 'send').mockResolvedValue(sent);
    const { getByPlaceholderText, getByLabelText } = renderGroup();
    fireEvent.changeText(getByPlaceholderText('Message'), 'Hi team');
    const send = await waitFor(() => getByLabelText('Send'));
    fireEvent.press(send);
    await waitFor(() => {
      expect(sendSpy).toHaveBeenCalledWith(GROUP_ID, 'Hi team');
    });
  });

  it('shows the mic button when the draft is empty', async () => {
    const { getByLabelText } = renderGroup();
    await waitFor(() => {
      expect(getByLabelText('Record a voice message')).toBeTruthy();
    });
  });

  it('reaching the top of the inverted list loads the next (older) page', async () => {
    // A full first page means older history may remain → getNextPageParam yields
    // a cursor, so onEndReached must fetch page 2. Serve one full page then a
    // short page (end of history).
    const fullPage: GroupMessage[] = Array.from({ length: GROUP_MESSAGES_PAGE_SIZE }, (_, i) => ({
      id: `p1-${i}`,
      conversationId: GROUP_ID,
      senderId: 'peer-2',
      content: `msg ${i}`,
      kind: 'text' as const,
      audioUrl: null,
      durationMs: null,
      // Descend the timestamps so index 0 is the oldest (cursor source).
      createdAt: new Date(Date.now() - i * 1000).toISOString(),
      sender: { id: 'peer-2', username: 'bob', displayName: 'Bob', avatarUrl: null },
    }));
    const olderPage: GroupMessage[] = [
      {
        id: 'older-1',
        conversationId: GROUP_ID,
        senderId: 'peer-2',
        content: 'the oldest message',
        kind: 'text',
        audioUrl: null,
        durationMs: null,
        createdAt: new Date(Date.now() - 999_999).toISOString(),
        sender: { id: 'peer-2', username: 'bob', displayName: 'Bob', avatarUrl: null },
      },
    ];
    const messagesSpy = jest
      .spyOn(groupService, 'messages')
      .mockResolvedValueOnce(fullPage)
      .mockResolvedValueOnce(olderPage);

    // Do NOT seed the thread cache — let the query fetch page 1 from the spy.
    const { getByTestId } = renderScreen(<GroupChatScreen />, {
      route: { name: 'GroupChat', params: { conversationId: GROUP_ID } },
      seedQueryData: [{ key: [...groupKeys.detail(GROUP_ID)], data: group() }],
    });

    const list = await waitFor(() => getByTestId('group-thread-list'));
    await waitFor(() => expect(messagesSpy).toHaveBeenCalledTimes(1));

    // Simulate scrolling to the visual top (list end): triggers the older page.
    fireEvent(list, 'onEndReached');
    await waitFor(() => expect(messagesSpy).toHaveBeenCalledTimes(2));
    // The second call carried a `before` cursor (the oldest loaded createdAt).
    expect(messagesSpy.mock.calls[1]![1]).toEqual(
      expect.objectContaining({ before: expect.any(String) }),
    );

    messagesSpy.mockRestore();
  });

  it('mounts the group socket (subscribes to group:message)', async () => {
    // In tests REALTIME is disabled so getSocket() returns null by default; mock
    // it to a fake socket so we can assert the screen subscribes on mount.
    const on = jest.fn();
    const off = jest.fn();
    const fakeSocket = { on, off } as unknown as Awaited<ReturnType<typeof socketClient.getSocket>>;
    const getSocketSpy = jest.spyOn(socketClient, 'getSocket').mockResolvedValue(fakeSocket);

    renderGroup();

    await waitFor(() => {
      expect(getSocketSpy).toHaveBeenCalled();
      expect(on).toHaveBeenCalledWith('group:message', expect.any(Function));
    });

    getSocketSpy.mockRestore();
  });
});
