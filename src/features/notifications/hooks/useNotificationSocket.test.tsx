import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { getSocket } from '../../../shared/services/realtime/socketClient';
import { mockAuthenticated, resetAuth } from '../../../test-utils/renderScreen';
import { profileKeys } from '../../profile/hooks/useProfile';
import { notificationKeys } from './useNotifications';
import { useNotificationSocket } from './useNotificationSocket';

jest.mock('../../../shared/services/realtime/socketClient', () => ({
  getSocket: jest.fn(),
  disconnectSocket: jest.fn(),
}));

describe('useNotificationSocket', () => {
  afterEach(() => {
    resetAuth();
    jest.clearAllMocks();
  });

  it('refreshes the follow-request inbox only for realtime FOLLOW_REQUEST events', async () => {
    mockAuthenticated();
    const listeners = new Map<string, (payload: unknown) => void>();
    const socket = {
      on: jest.fn((event: string, listener: (payload: unknown) => void) => {
        listeners.set(event, listener);
      }),
      off: jest.fn(),
    } as unknown as Awaited<ReturnType<typeof getSocket>>;
    jest.mocked(getSocket).mockResolvedValue(socket);

    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const invalidate = jest.spyOn(client, 'invalidateQueries').mockResolvedValue(undefined);
    const wrapper: React.FC<React.PropsWithChildren> = ({ children }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );

    const { unmount } = renderHook(() => useNotificationSocket(), { wrapper });
    await waitFor(() => expect(listeners.get('notification:new')).toEqual(expect.any(Function)));

    act(() => listeners.get('notification:new')?.({ type: 'FOLLOW_REQUEST' }));
    await waitFor(() => {
      expect(invalidate).toHaveBeenCalledWith({ queryKey: notificationKeys.all });
      expect(invalidate).toHaveBeenCalledWith({ queryKey: profileKeys.followRequests() });
    });

    invalidate.mockClear();
    act(() => listeners.get('notification:new')?.({ type: 'ROOM_STARTED' }));
    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({ queryKey: notificationKeys.all }),
    );
    expect(invalidate).not.toHaveBeenCalledWith({ queryKey: profileKeys.followRequests() });

    unmount();
    expect(socket?.off).toHaveBeenCalledWith('notification:new', expect.any(Function));
    client.clear();
  });
});
