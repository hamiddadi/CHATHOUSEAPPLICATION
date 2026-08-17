import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { _resetRoomSocketAdmissionsForTests } from '../services/roomSocketAdmission';
import { useRoomSocket } from './useRoomSocket';

const mockSocket = {
  id: 'socket-1',
  connected: true,
  emit: jest.fn(),
  on: jest.fn(),
  off: jest.fn(),
};
const mockUnsubscribeReconnect = jest.fn();
let mockReconnectHandler: (() => void) | null = null;

jest.mock('../../../shared/services/realtime/socketClient', () => ({
  getSocket: jest.fn(async () => mockSocket),
  onReconnect: jest.fn((handler: () => void) => {
    mockReconnectHandler = handler;
    return mockUnsubscribeReconnect;
  }),
  disconnectSocket: jest.fn(),
}));

describe('useRoomSocket room lifecycle', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    _resetRoomSocketAdmissionsForTests();
    mockSocket.id = 'socket-1';
    mockSocket.connected = true;
    mockReconnectHandler = null;
    mockSocket.emit.mockImplementation((_event, _payload, ack?: (ok: boolean) => void) => {
      ack?.(true);
      return mockSocket;
    });
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

  it('ignores a stale denied ack after reconnect and waits for the new socket ack', async () => {
    const acknowledgements: Array<(ok: boolean) => void> = [];
    mockSocket.emit.mockImplementation((_event, _payload, ack?: (ok: boolean) => void) => {
      if (ack) acknowledgements.push(ack);
      return mockSocket;
    });
    const onJoinDenied = jest.fn();
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const wrapper: React.FC<React.PropsWithChildren> = ({ children }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );

    const { result, unmount } = renderHook(() => useRoomSocket('room-race', onJoinDenied), {
      wrapper,
    });
    await waitFor(() => expect(acknowledgements).toHaveLength(1));
    expect(result.current).toBe(false);

    act(() => {
      mockSocket.id = 'socket-2';
      mockReconnectHandler?.();
    });
    await waitFor(() => expect(acknowledgements).toHaveLength(2));

    act(() => acknowledgements[0]?.(false));
    act(() => acknowledgements[1]?.(true));
    await waitFor(() => expect(result.current).toBe(true));
    expect(onJoinDenied).not.toHaveBeenCalled();

    unmount();
    client.clear();
  });
});
