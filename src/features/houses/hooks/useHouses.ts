import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { houseService, type CreateHouseInput } from '../services/houseService';
import type { House, HouseSummary } from '../../../shared/types/domain';

export const houseKeys = {
  all: ['houses'] as const,
  list: (filter: 'mine' | 'discover') => [...houseKeys.all, 'list', filter] as const,
  detail: (id: string) => [...houseKeys.all, 'detail', id] as const,
};

export const useHouses = (filter: 'mine' | 'discover' = 'mine') =>
  useQuery<HouseSummary[]>({
    queryKey: houseKeys.list(filter),
    queryFn: () => houseService.list(filter),
  });

export const useHouse = (houseId: string) =>
  useQuery<House>({
    queryKey: houseKeys.detail(houseId),
    queryFn: () => houseService.get(houseId),
    enabled: houseId.length > 0,
  });

export const useCreateHouse = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateHouseInput) => houseService.create(input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: houseKeys.all });
    },
  });
};

export const useJoinHouse = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (houseId: string) => houseService.join(houseId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: houseKeys.all });
    },
  });
};

export const useInviteToHouse = () =>
  useMutation({
    mutationFn: ({ houseId, userIds }: { houseId: string; userIds: readonly string[] }) =>
      houseService.invite(houseId, userIds),
  });

export const useAcceptInvitation = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ houseId, inviteToken }: { houseId: string; inviteToken?: string }) =>
      houseService.acceptInvitation(houseId, inviteToken),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: houseKeys.all });
    },
  });
};
