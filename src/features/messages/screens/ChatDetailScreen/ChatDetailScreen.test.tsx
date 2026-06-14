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
import { messageKeys } from '../../hooks/useMessages';
import { renderScreen, mockAuthenticated, resetAuth } from '../../../../test-utils/renderScreen';
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

const renderChat = () =>
  renderScreen(<ChatDetailScreen />, {
    route: { name: 'ChatDetail', params: { conversationId: PEER_ID } },
    seedQueryData: [
      { key: [...messageKeys.conversation(PEER_ID)], data: conversation() },
      { key: [...messageKeys.messages(PEER_ID)], data: messages() },
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

  it('emoji button appends to the draft and reveals the send button', async () => {
    const { getByLabelText, queryByLabelText } = renderChat();
    // With an empty draft the mic button shows; send is hidden.
    expect(queryByLabelText('Send message')).toBeNull();
    fireEvent.press(getByLabelText('Insert emoji'));
    await waitFor(() => {
      expect(getByLabelText('Send message')).toBeTruthy();
    });
  });

  it('typing then pressing send does not crash and clears nothing unexpectedly', async () => {
    const { getByLabelText, getByPlaceholderText } = renderChat();
    fireEvent.changeText(getByPlaceholderText('Type a message…'), 'Hello world');
    const send = await waitFor(() => getByLabelText('Send message'));
    // The send mutation fires against the (unmocked) apiClient and will reject;
    // handleSend awaits + reports via toast. We assert the press itself is safe.
    expect(() => fireEvent.press(send)).not.toThrow();
  });

  it('attach button surfaces a "coming soon" Alert (no crash)', () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const { getByLabelText } = renderChat();
    fireEvent.press(getByLabelText('Attach file'));
    expect(alertSpy).toHaveBeenCalledTimes(1);
  });
});
