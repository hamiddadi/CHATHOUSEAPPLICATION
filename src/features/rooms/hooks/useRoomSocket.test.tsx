import React from 'react';
import { renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useRoomSocket } from './useRoomSocket';

const mockSocket = {
  emit: jest.fn(),
  on: jest.fn(),
  off: jest.fn(),
};
const mockUnsubscribeReconnect = jest.fn();

jest.mock('../../../shared/services/realtime/socketClient', () => ({
  getSocket: jest.fn(async () => mockSocket),
  onReconnect: jest.fn(() => mockUnsubscribeReconnect),
  disconnectSocket: jest.fn(),
}));

describe('useRoomSocket room lifecycle', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('keeps room membership when the screen unmounts into the persistent mini-bar', async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const wrapper: React.FC<React.PropsWithChildren> = ({ children }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );

    const { unmount } = renderHook(() => useRoomSocket('room-1'), { wrapper });
    await waitFor(() =>
      expect(mockSocket.emit).toHaveBeenCalledWith(
        'room:join',
        { roomId: 'room-1' },
        expect.any(Function),
      ),
    );

    unmount();

    expect(mockSocket.emit).not.toHaveBeenCalledWith('room:leave', expect.anything());
    expect(mockUnsubscribeReconnect).toHaveBeenCalledTimes(1);
    expect(mockSocket.off).toHaveBeenCalled();
    client.clear();
  });
});
