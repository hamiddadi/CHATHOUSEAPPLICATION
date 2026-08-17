import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { shareApi, type ShareLinks } from '../api/shareApi';
import { ExtShareSheet } from './ExtShareSheet';

jest.mock('../api/shareApi', () => ({ shareApi: { forRoom: jest.fn() } }));

const mockForRoom = shareApi.forRoom as jest.Mock;
const LINKS: ShareLinks = {
  url: 'https://example.test/rooms/room-1',
  text: 'Join the room',
  twitter: 'https://twitter.test/share',
  whatsapp: 'https://whatsapp.test/share',
  telegram: 'https://telegram.test/share',
};

describe('ExtShareSheet', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('exposes named share and cancel actions after loading', async () => {
    mockForRoom.mockResolvedValue(LINKS);
    const onClose = jest.fn();
    const { getByLabelText } = render(<ExtShareSheet roomId="room-1" visible onClose={onClose} />);

    expect(await waitFor(() => getByLabelText('Share via WhatsApp'))).toBeTruthy();
    fireEvent.press(getByLabelText('Cancel'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps Cancel available on failure and retries successfully', async () => {
    mockForRoom.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(LINKS);
    const { getByLabelText, getByText } = render(
      <ExtShareSheet roomId="room-1" visible onClose={jest.fn()} />,
    );

    expect(await waitFor(() => getByText('Failed to build share links.'))).toBeTruthy();
    expect(getByLabelText('Cancel')).toBeTruthy();
    fireEvent.press(getByLabelText('Retry'));

    expect(await waitFor(() => getByLabelText('Share via WhatsApp'))).toBeTruthy();
    expect(mockForRoom).toHaveBeenCalledTimes(2);
  });
});
