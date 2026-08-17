import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { groupService, type GroupConversation } from '../services/groupService';
import { GROUPS_PAGE_SIZE, useGroups } from './useGroups';

const group = (id: string): GroupConversation => ({
  id,
  title: id,
  ownerId: 'viewer',
  members: [],
  lastMessage: null,
  unreadCount: 0,
  updatedAt: '2026-08-13T12:00:00.000Z',
});

describe('useGroups pagination', () => {
  afterEach(() => jest.restoreAllMocks());

  it('feeds the opaque cursor into page two and flattens both pages', async () => {
    const service = jest
      .spyOn(groupService, 'list')
      .mockResolvedValueOnce({
        items: [group('group-1')],
        nextCursor: 'v1.page-two',
        hasMore: true,
      })
      .mockResolvedValueOnce({
        items: [group('group-2')],
        nextCursor: null,
        hasMore: false,
      });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    });
    const wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useGroups(), { wrapper });

    await waitFor(() => expect(result.current.data?.map(item => item.id)).toEqual(['group-1']));
    expect(result.current.hasNextPage).toBe(true);

    await act(async () => {
      await result.current.fetchNextPage();
    });

    expect(service).toHaveBeenNthCalledWith(1, { cursor: undefined, limit: GROUPS_PAGE_SIZE });
    expect(service).toHaveBeenNthCalledWith(2, {
      cursor: 'v1.page-two',
      limit: GROUPS_PAGE_SIZE,
    });
    await waitFor(() => {
      expect(result.current.data?.map(item => item.id)).toEqual(['group-1', 'group-2']);
      expect(result.current.hasNextPage).toBe(false);
    });
  });
});
