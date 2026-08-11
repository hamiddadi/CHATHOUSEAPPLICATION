import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Conversation } from '../../../shared/types/domain';
import { messageService } from '../services/messageService';
import { useConversations } from './useMessages';

const conversation = (id: string, name: string): Conversation => ({
  id,
  participants: [{ id, username: name.toLowerCase(), displayName: name, avatarUrl: null }],
  lastMessage: {
    id: `message-${id}`,
    conversationId: id,
    authorId: id,
    text: `hello from ${name}`,
    kind: 'text',
    audioUrl: null,
    durationMs: null,
    sentAt: '2026-08-10T12:00:00.000Z',
    isMine: false,
  },
  unreadCount: 0,
  updatedAt: '2026-08-10T12:00:00.000Z',
});

describe('useConversations pagination', () => {
  afterEach(() => jest.restoreAllMocks());

  it('feeds the backend cursor into page two and flattens both pages for the UI', async () => {
    const service = jest
      .spyOn(messageService, 'conversations')
      .mockResolvedValueOnce({
        items: [conversation('peer-1', 'Alice')],
        nextCursor: 'v1.page-two',
      })
      .mockResolvedValueOnce({
        items: [conversation('peer-2', 'Bob')],
        nextCursor: null,
      });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    });
    const wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useConversations(), { wrapper });

    await waitFor(() => expect(result.current.data?.map(item => item.id)).toEqual(['peer-1']));
    expect(result.current.hasNextPage).toBe(true);

    await act(async () => {
      await result.current.fetchNextPage();
    });

    expect(service).toHaveBeenNthCalledWith(1, undefined);
    expect(service).toHaveBeenNthCalledWith(2, 'v1.page-two');
    await waitFor(() => {
      expect(result.current.data?.map(item => item.id)).toEqual(['peer-1', 'peer-2']);
      expect(result.current.hasNextPage).toBe(false);
    });
  });
});
