import React from 'react';
import { act, renderHook } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { House } from '../../../shared/types/domain';
import { houseService, type CreateHouseInput } from '../services/houseService';
import { useCreateHouse } from './useHouses';

const input: CreateHouseInput = {
  name: 'Retry-safe house',
  description: '',
  privacy: 'open',
};
const house = { id: 'house-1' } as House;

const setup = () => {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false, retryDelay: 0, gcTime: Infinity },
    },
  });
  const wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return wrapper;
};

describe('house creation idempotency across React Query transport retries', () => {
  afterEach(() => jest.restoreAllMocks());

  it('reuses one key for a transient retry and creates a new key for a new action', async () => {
    const create = jest
      .spyOn(houseService, 'create')
      .mockRejectedValueOnce({ kind: 'network', message: 'temporary transport failure' })
      .mockResolvedValue(house);
    const { result } = renderHook(() => useCreateHouse(), { wrapper: setup() });

    await act(async () => {
      await result.current.mutateAsync(input);
    });

    expect(create).toHaveBeenCalledTimes(2);
    const firstKey = create.mock.calls[0]?.[1];
    expect(firstKey).toMatch(/^rn-/);
    expect(create.mock.calls[1]?.[1]).toBe(firstKey);

    await act(async () => {
      await result.current.mutateAsync({ ...input, name: 'Second action' });
    });
    expect(create.mock.calls[2]?.[1]).toMatch(/^rn-/);
    expect(create.mock.calls[2]?.[1]).not.toBe(firstKey);
  });

  it('does not retry a deterministic validation response', async () => {
    const create = jest
      .spyOn(houseService, 'create')
      .mockRejectedValue({ kind: 'validation', message: 'name already exists' });
    const { result } = renderHook(() => useCreateHouse(), { wrapper: setup() });

    await expect(result.current.mutateAsync(input)).rejects.toMatchObject({ kind: 'validation' });
    expect(create).toHaveBeenCalledTimes(1);
  });
});
