import React from 'react';
import { ActivityIndicator, Alert, StyleSheet } from 'react-native';
import { act, fireEvent, waitFor } from '@testing-library/react-native';
import { i18n } from '../../../../core/i18n';
import { renderScreen, mockAuthenticated, resetAuth } from '../../../../test-utils/renderScreen';
import { colors } from '../../../../shared/constants/theme';
import { roomKeys } from '../../hooks/useRooms';
import { roomService } from '../../services/roomService';
import { RoomChatSidebar } from './RoomChatSidebar';

const ROOM_ID = 'room-report-1';

const messages = [
  {
    id: 'room-message-1',
    content: 'unsafe room message',
    createdAt: new Date(0).toISOString(),
    user: {
      id: 'peer-room',
      username: 'peer',
      displayName: 'Room Peer',
      avatarUrl: null,
    },
    replyTo: null,
  },
];

describe('RoomChatSidebar content reporting', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
    mockAuthenticated();
  });

  afterEach(() => {
    resetAuth();
    jest.restoreAllMocks();
  });

  it('exposes a report action for another participant message and submits it', async () => {
    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const reportSpy = jest
      .spyOn(roomService, 'reportMessage')
      .mockResolvedValue({ reportId: 'room-report', alreadyReported: false });
    const { getByLabelText, getByText } = renderScreen(
      <RoomChatSidebar visible roomId={ROOM_ID} onClose={jest.fn()} />,
      {
        seedQueryData: [
          {
            key: [...roomKeys.all, 'messages', ROOM_ID],
            data: messages,
          },
        ],
      },
    );

    fireEvent.press(getByLabelText('Report this message'));
    fireEvent.press(await waitFor(() => getByText('Spam')));

    await waitFor(() => expect(reportSpy).toHaveBeenCalledWith(ROOM_ID, 'room-message-1', 'spam'));
  });

  it('exposes localised chat controls with explicit accessibility state', () => {
    const onClose = jest.fn();
    const { getByLabelText, getByPlaceholderText, getByRole } = renderScreen(
      <RoomChatSidebar visible roomId={ROOM_ID} onClose={onClose} />,
    );

    expect(getByRole('header', { name: 'Room chat' })).toBeTruthy();
    expect(getByLabelText('Room chat messages').props.accessibilityRole).toBe('list');
    expect(getByPlaceholderText('Write a message…')).toBeTruthy();

    const sendButton = getByLabelText('Send message');
    expect(sendButton.props.accessibilityState).toEqual({ busy: false, disabled: true });

    fireEvent.press(getByLabelText('Close room chat'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('localises the posting gate and message actions in French', async () => {
    await i18n.changeLanguage('fr');
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const { getByLabelText, getByRole, getByText, queryByLabelText } = renderScreen(
      <RoomChatSidebar
        visible
        roomId={ROOM_ID}
        onClose={jest.fn()}
        chatEnabled={false}
        canModerate
      />,
      {
        seedQueryData: [
          {
            key: [...roomKeys.all, 'messages', ROOM_ID],
            data: messages,
          },
        ],
      },
    );

    expect(getByRole('header', { name: 'Chat de la room' })).toBeTruthy();
    expect(getByText('Le chat est désactivé pour cette room.')).toBeTruthy();
    expect(queryByLabelText('Message de chat')).toBeNull();

    const message = getByLabelText('Message de Room Peer');
    expect(message.props.accessibilityHint).toBe('Maintenez appuyé pour répondre');
    expect(message.findAllByProps({ accessibilityLabel: 'Supprimer le message' })).toHaveLength(0);

    fireEvent.press(getByLabelText('Supprimer le message'));
    expect(alertSpy).toHaveBeenCalledWith(
      'Supprimer le message',
      'Supprimer ce message du chat ?',
      expect.arrayContaining([
        expect.objectContaining({ text: 'Annuler', style: 'cancel' }),
        expect.objectContaining({ text: 'Supprimer', style: 'destructive' }),
      ]),
    );
  });

  it('announces the active reply and exposes a localised cancel action', () => {
    const { getByLabelText, getByPlaceholderText, getByText } = renderScreen(
      <RoomChatSidebar visible roomId={ROOM_ID} onClose={jest.fn()} />,
      {
        seedQueryData: [
          {
            key: [...roomKeys.all, 'messages', ROOM_ID],
            data: messages,
          },
        ],
      },
    );

    fireEvent(getByLabelText('Message from Room Peer'), 'longPress');

    expect(getByText('Replying to @peer')).toBeTruthy();
    expect(getByPlaceholderText('Reply…')).toBeTruthy();

    fireEvent.press(getByLabelText('Cancel reply'));
    expect(getByPlaceholderText('Write a message…')).toBeTruthy();
  });

  it('starts a reply through the message accessibility action', () => {
    const { getByLabelText, getByPlaceholderText } = renderScreen(
      <RoomChatSidebar visible roomId={ROOM_ID} onClose={jest.fn()} />,
      {
        seedQueryData: [{ key: [...roomKeys.all, 'messages', ROOM_ID], data: messages }],
      },
    );

    const message = getByLabelText('Message from Room Peer');
    fireEvent(message, 'accessibilityAction', {
      nativeEvent: { actionName: 'reply' },
    });
    expect(getByPlaceholderText('Reply…')).toBeTruthy();
  });

  it('synchronously blocks a double send while the first room message is pending', async () => {
    let resolveSend!: (message: Awaited<ReturnType<typeof roomService.sendMessage>>) => void;
    const pendingSend = new Promise<Awaited<ReturnType<typeof roomService.sendMessage>>>(
      resolve => {
        resolveSend = resolve;
      },
    );
    const sendSpy = jest.spyOn(roomService, 'sendMessage').mockReturnValue(pendingSend);
    const { getByLabelText } = renderScreen(
      <RoomChatSidebar visible roomId={ROOM_ID} onClose={jest.fn()} />,
      {
        seedQueryData: [
          {
            key: [...roomKeys.all, 'messages', ROOM_ID],
            data: messages,
          },
        ],
      },
    );

    fireEvent.changeText(getByLabelText('Chat message'), 'Only once');
    expect(StyleSheet.flatten(getByLabelText('Chat message').props.style).minHeight).toBe(44);
    const sendButton = getByLabelText('Send message');
    fireEvent.press(sendButton);
    fireEvent.press(sendButton);

    await waitFor(() => {
      expect(sendSpy).toHaveBeenCalledTimes(1);
      const pendingButton = getByLabelText('Send message');
      const pendingStyle = StyleSheet.flatten(pendingButton.props.style);
      expect(pendingButton.props.accessibilityState).toEqual({ busy: true, disabled: true });
      expect(pendingStyle).toMatchObject({
        backgroundColor: colors.primary,
        width: 44,
        height: 44,
      });
      expect(pendingButton.findByType(ActivityIndicator).props.color).toBe(colors.onPrimary);
    });
    expect(sendSpy).toHaveBeenCalledWith(ROOM_ID, 'Only once', undefined);

    await act(async () => {
      resolveSend({ ...messages[0]!, id: 'sent-room-message' });
      await pendingSend;
    });
  });
});
