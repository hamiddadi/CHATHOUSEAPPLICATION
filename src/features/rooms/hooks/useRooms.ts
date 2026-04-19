import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { roomService, type CreateRoomInput } from '../services/roomService';
import type { Room, RoomSummary } from '../../../shared/types/domain';

export const roomKeys = {
  all: ['rooms'] as const,
  list: () => [...roomKeys.all, 'list'] as const,
  detail: (id: string) => [...roomKeys.all, 'detail', id] as const,
};

export const useRooms = () =>
  useQuery<RoomSummary[]>({
    queryKey: roomKeys.list(),
    queryFn: () => roomService.list(),
  });

export const useRoom = (roomId: string) =>
  useQuery<Room>({
    queryKey: roomKeys.detail(roomId),
    queryFn: () => roomService.get(roomId),
    enabled: roomId.length > 0,
  });

export const useCreateRoom = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateRoomInput) => roomService.create(input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: roomKeys.list() });
    },
  });
};

export const useJoinRoom = () =>
  useMutation({ mutationFn: (roomId: string) => roomService.join(roomId) });

export const useLeaveRoom = () =>
  useMutation({ mutationFn: (roomId: string) => roomService.leave(roomId) });

export const useRaiseHand = () =>
  useMutation({ mutationFn: (roomId: string) => roomService.raiseHand(roomId) });
