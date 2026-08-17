import React from 'react';
import { act, renderHook } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { roomService, type CreateRoomInput } from '../services/roomService';
import { useCreateRoom } from './useRooms';

jest.mock('../services/roomAudioSession', () => ({ roomAudioSession: { stop: jest.fn() } }));

const input: CreateRoomInput = { title: 'Retry-safe room', visibility: 'public' };
const room = { id: 'room-1' } as Awaited<ReturnType<typeof roomService.create>>;

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
  return wrapper;
};

describe('room creation idempotency across React Query transport retries', () => {
  afterEach(() => jest.restoreAllMocks());

  it('reuses one key for a retry and creates a new key for a new user action', async () => {
    const create = jest
      .spyOn(roomService, 'create')
      .mockRejectedValueOnce({ kind: 'network', message: 'temporary transport failure' })
      .mockResolvedValue(room);
    const { result } = renderHook(() => useCreateRoom(), { wrapper: setup() });

    await act(async () => {
      await result.current.mutateAsync(input);
    });

    expect(create).toHaveBeenCalledTimes(2);
    const firstKey = create.mock.calls[0]?.[1];
    expect(firstKey).toMatch(/^rn-/);
    expect(create.mock.calls[1]?.[1]).toBe(firstKey);

    await act(async () => {
      await result.current.mutateAsync({ ...input, title: 'Second action' });
    });
    expect(create.mock.calls[2]?.[1]).toMatch(/^rn-/);
    expect(create.mock.calls[2]?.[1]).not.toBe(firstKey);
  });
});
