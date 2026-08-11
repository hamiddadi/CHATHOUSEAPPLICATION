import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AppNotification } from '../../../shared/types/domain';
import { notificationService } from '../services/notificationService';
import { useNotifications } from './useNotifications';

const notification = (id: string): AppNotification => ({
  id,
  kind: 'follow',
  actor: { id: `actor-${id}`, username: '', displayName: id, avatarUrl: null },
  message: id,
  roomId: null,
  houseId: null,
  createdAt: '2026-08-10T12:00:00.000Z',
  isRead: false,
});

describe('useNotifications pagination', () => {
  afterEach(() => jest.restoreAllMocks());

  it('threads the opaque cursor into page two and flattens the history', async () => {
    const service = jest
      .spyOn(notificationService, 'list')
      .mockResolvedValueOnce({
        items: [notification('new')],
        nextCursor: 'v1.page-two',
        hasMore: true,
      })
      .mockResolvedValueOnce({
        items: [notification('old')],
        nextCursor: null,
        hasMore: false,
      });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    });
    const wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useNotifications('rooms'), { wrapper });

    await waitFor(() => expect(result.current.data?.map(item => item.id)).toEqual(['new']));
    expect(result.current.hasNextPage).toBe(true);

    await act(async () => {
      await result.current.fetchNextPage();
    });

    expect(service).toHaveBeenNthCalledWith(1, 'rooms', undefined);
    expect(service).toHaveBeenNthCalledWith(2, 'rooms', 'v1.page-two');
    // `fetchNextPage()` resolves when the fetch is complete, while the query
    // observer can publish its selected/flattened result on the following
    // React turn under load. Wait for that observable state instead of making
    // the test depend on scheduler timing.
    await waitFor(() => {
      expect(result.current.data?.map(item => item.id)).toEqual(['new', 'old']);
      expect(result.current.hasNextPage).toBe(false);
    });
  });
});
