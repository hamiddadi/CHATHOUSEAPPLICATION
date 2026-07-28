import React from 'react';
import { Alert } from 'react-native';
import { fireEvent, waitFor } from '@testing-library/react-native';
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
  beforeEach(() => {
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
});
