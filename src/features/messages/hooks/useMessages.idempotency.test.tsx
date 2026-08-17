import React from 'react';
import { act, renderHook } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Message } from '../../../shared/types/domain';
import { messageService } from '../services/messageService';
import { messageKeys, useSendMessage, useSendVoiceMessage } from './useMessages';

const message = (kind: 'text' | 'voice'): Message => ({
  id: `message-${kind}`,
  conversationId: 'peer-1',
  authorId: 'viewer-1',
  text: kind === 'text' ? 'hello' : '',
  kind,
  audioUrl: kind === 'voice' ? 'https://api.example.test/media/voice/signed' : null,
  durationMs: kind === 'voice' ? 4_250 : null,
  sentAt: '2026-08-10T12:00:00.000Z',
  isMine: true,
});

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

describe('DM idempotency across React Query transport retries', () => {
  afterEach(() => jest.restoreAllMocks());

  it('reuses one text key for a retry and generates a new key for a new mutation', async () => {
    const send = jest
      .spyOn(messageService, 'send')
      .mockRejectedValueOnce({ kind: 'network', message: 'temporary transport failure' })
      .mockResolvedValue(message('text'));
    const { client, wrapper } = setup();
    const { result } = renderHook(() => useSendMessage(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ conversationId: 'peer-1', text: 'hello' });
    });

    expect(send).toHaveBeenCalledTimes(2);
    const firstKey = send.mock.calls[0]?.[2];
    expect(firstKey).toMatch(/^rn-/);
    expect(send.mock.calls[1]?.[2]).toBe(firstKey);
    const cached = client.getQueryData<{ pages: Array<{ items: Message[] }> }>(
      messageKeys.messages('peer-1'),
    );
    expect(cached?.pages[0]?.items).toHaveLength(1);

    await act(async () => {
      await result.current.mutateAsync({ conversationId: 'peer-1', text: 'hello again' });
    });
    expect(send.mock.calls[2]?.[2]).toMatch(/^rn-/);
    expect(send.mock.calls[2]?.[2]).not.toBe(firstKey);
  });

  it('reuses one voice key when React Query retries the send after upload', async () => {
    const sendVoice = jest
      .spyOn(messageService, 'sendVoice')
      .mockRejectedValueOnce({ kind: 'network', message: 'temporary transport failure' })
      .mockResolvedValue(message('voice'));
    const { wrapper } = setup();
    const { result } = renderHook(() => useSendVoiceMessage(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        conversationId: 'peer-1',
        audioUrl: 'https://api.example.test/media/voice/signed',
        durationMs: 4_250,
      });
    });

    expect(sendVoice).toHaveBeenCalledTimes(2);
    const firstKey = sendVoice.mock.calls[0]?.[3];
    expect(firstKey).toMatch(/^rn-/);
    expect(sendVoice.mock.calls[1]?.[3]).toBe(firstKey);
  });

  it('does not append a replay already restored by a socket-triggered refetch', async () => {
    const sent = message('text');
    jest.spyOn(messageService, 'send').mockResolvedValue(sent);
    const { client, wrapper } = setup();
    client.setQueryData(messageKeys.messages('peer-1'), {
      pages: [{ items: [sent], nextCursor: null }],
      pageParams: [undefined],
    });
    const { result } = renderHook(() => useSendMessage(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ conversationId: 'peer-1', text: 'hello' });
    });

    const cached = client.getQueryData<{ pages: Array<{ items: Message[] }> }>(
      messageKeys.messages('peer-1'),
    );
    expect(cached?.pages[0]?.items.map(item => item.id)).toEqual([sent.id]);
  });
});
