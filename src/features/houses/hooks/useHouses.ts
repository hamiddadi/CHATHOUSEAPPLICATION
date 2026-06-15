import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  houseService,
  type CreateHouseInput,
  type HouseMemberRole,
  type HouseRoom,
  type UpdateHouseInput,
} from '../services/houseService';
import type { House, HouseSummary } from '../../../shared/types/domain';

export const houseKeys = {
  all: ['houses'] as const,
  list: (filter: 'mine' | 'discover') => [...houseKeys.all, 'list', filter] as const,
  detail: (id: string) => [...houseKeys.all, 'detail', id] as const,
  rooms: (id: string, filter: 'live' | 'upcoming') =>
    [...houseKeys.all, 'rooms', id, filter] as const,
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

export const useUpdateHouse = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ houseId, input }: { houseId: string; input: UpdateHouseInput }) =>
      houseService.update(houseId, input),
    onSuccess: updated => {
      // Seed the detail cache with the refreshed club and invalidate the
      // lists/membership-derived views so they refetch.
      qc.setQueryData(houseKeys.detail(updated.id), updated);
      void qc.invalidateQueries({ queryKey: houseKeys.all });
    },
  });
};

export const useDeleteHouse = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (houseId: string) => houseService.remove(houseId),
    onSuccess: (_result, houseId) => {
      qc.removeQueries({ queryKey: houseKeys.detail(houseId) });
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

export const useLeaveHouse = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (houseId: string) => houseService.leave(houseId),
    onSuccess: (_result, houseId) => {
      void qc.invalidateQueries({ queryKey: houseKeys.detail(houseId) });
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

export const useSetMemberRole = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      houseId,
      userId,
      role,
    }: {
      houseId: string;
      userId: string;
      role: HouseMemberRole;
    }) => houseService.setMemberRole(houseId, userId, role),
    onSuccess: updated => {
      // The PATCH returns the refreshed club; seed the detail cache and
      // invalidate so any list/membership-derived views refetch.
      qc.setQueryData(houseKeys.detail(updated.id), updated);
      void qc.invalidateQueries({ queryKey: houseKeys.all });
    },
  });
};

export const useHouseRooms = (houseId: string, filter: 'live' | 'upcoming') =>
  useQuery<HouseRoom[]>({
    queryKey: houseKeys.rooms(houseId, filter),
    queryFn: () => houseService.listRooms(houseId, filter),
    enabled: houseId.length > 0,
  });
