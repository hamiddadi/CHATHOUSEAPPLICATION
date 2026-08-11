import React from 'react';
import { act, renderHook } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { groupService, type GroupConversation, type GroupMessage } from '../services/groupService';
import {
  groupKeys,
  useAddGroupMembers,
  useCreateGroup,
  useSendGroupMessage,
  useSendGroupVoice,
} from './useGroups';

const groupMessage = (kind: 'text' | 'voice' = 'text'): GroupMessage => ({
  id: `group-message-${kind}`,
  conversationId: 'group-1',
  senderId: 'viewer-1',
  content: kind === 'text' ? 'hello group' : null,
  kind,
  audioUrl: kind === 'voice' ? 'https://api.example.test/media/voice/signed' : null,
  durationMs: kind === 'voice' ? 4_250 : null,
  createdAt: '2026-08-10T12:00:00.000Z',
  sender: { id: 'viewer-1', username: 'viewer', displayName: 'Viewer', avatarUrl: null },
});

const group: GroupConversation = {
  id: 'group-1',
  title: 'Group',
  ownerId: 'viewer-1',
  members: [],
  lastMessage: null,
  unreadCount: 0,
  updatedAt: '2026-08-10T12:00:00.000Z',
};

const setup = () => {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: 1, retryDelay: 0, gcTime: Infinity },
    },
  });
  const wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, wrapper };
};

describe('group idempotency across React Query transport retries', () => {
  afterEach(() => jest.restoreAllMocks());

  it('reuses one text key, gives a new action a new key, and deduplicates a socket-refetched row', async () => {
    const sent = groupMessage('text');
    const send = jest
      .spyOn(groupService, 'send')
      .mockRejectedValueOnce({ kind: 'network', message: 'temporary transport failure' })
      .mockResolvedValue(sent);
    const { client, wrapper } = setup();
    client.setQueryData(groupKeys.messages('group-1'), {
      pages: [{ items: [sent], nextCursor: null }],
      pageParams: [undefined],
    });
    const { result } = renderHook(() => useSendGroupMessage(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ conversationId: 'group-1', text: 'hello group' });
    });

    expect(send).toHaveBeenCalledTimes(2);
    const firstKey = send.mock.calls[0]?.[2];
    expect(firstKey).toMatch(/^rn-/);
    expect(send.mock.calls[1]?.[2]).toBe(firstKey);
    const cached = client.getQueryData<{ pages: Array<{ items: GroupMessage[] }> }>(
      groupKeys.messages('group-1'),
    );
    expect(cached?.pages[0]?.items.map(message => message.id)).toEqual([sent.id]);

    await act(async () => {
      await result.current.mutateAsync({ conversationId: 'group-1', text: 'another action' });
    });
    expect(send.mock.calls[2]?.[2]).toMatch(/^rn-/);
    expect(send.mock.calls[2]?.[2]).not.toBe(firstKey);
  });

  it('reuses one voice-message key for the retry', async () => {
    const sendVoice = jest
      .spyOn(groupService, 'sendVoice')
      .mockRejectedValueOnce({ kind: 'network', message: 'temporary transport failure' })
      .mockResolvedValue(groupMessage('voice'));
    const { wrapper } = setup();
    const { result } = renderHook(() => useSendGroupVoice(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        conversationId: 'group-1',
        audioUrl: 'https://api.example.test/media/voice/signed',
        durationMs: 4_250,
      });
    });

    expect(sendVoice).toHaveBeenCalledTimes(2);
    expect(sendVoice.mock.calls[0]?.[3]).toMatch(/^rn-/);
    expect(sendVoice.mock.calls[1]?.[3]).toBe(sendVoice.mock.calls[0]?.[3]);
  });

  it('reuses one group-creation key for the retry', async () => {
    const create = jest
      .spyOn(groupService, 'create')
      .mockRejectedValueOnce({ kind: 'network', message: 'temporary transport failure' })
      .mockResolvedValue(group);
    const { wrapper } = setup();
    const { result } = renderHook(() => useCreateGroup(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ memberIds: ['member-1'], title: 'Group' });
    });

    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[0]?.[2]).toMatch(/^rn-/);
    expect(create.mock.calls[1]?.[2]).toBe(create.mock.calls[0]?.[2]);
  });

  it('reuses one add-members key for the retry', async () => {
    const addMembers = jest
      .spyOn(groupService, 'addMembers')
      .mockRejectedValueOnce({ kind: 'network', message: 'temporary transport failure' })
      .mockResolvedValue(group);
    const { wrapper } = setup();
    const { result } = renderHook(() => useAddGroupMembers(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ conversationId: 'group-1', userIds: ['member-1'] });
    });

    expect(addMembers).toHaveBeenCalledTimes(2);
    expect(addMembers.mock.calls[0]?.[2]).toMatch(/^rn-/);
    expect(addMembers.mock.calls[1]?.[2]).toBe(addMembers.mock.calls[0]?.[2]);
  });
});
