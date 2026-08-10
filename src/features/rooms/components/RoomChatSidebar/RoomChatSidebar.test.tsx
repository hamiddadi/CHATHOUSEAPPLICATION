import React from 'react';
import { Alert } from 'react-native';
import { fireEvent, waitFor } from '@testing-library/react-native';
import { i18n } from '../../../../core/i18n';
import { renderScreen, mockAuthenticated, resetAuth } from '../../../../test-utils/renderScreen';
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
});
