import { useQuery } from '@tanstack/react-query';
import { recordingService, type Replay } from '../services/recordingService';

export const recordingKeys = {
  all: ['recordings'] as const,
  recent: () => [...recordingKeys.all, 'recent'] as const,
  room: (id: string) => [...recordingKeys.all, 'room', id] as const,
};

/** Recent public replays across all rooms (Replays feed). */
export const useRecentReplays = () =>
  useQuery<Replay[]>({
    queryKey: recordingKeys.recent(),
    queryFn: () => recordingService.recent(),
  });

/** Completed replays for a single room. */
export const useRoomReplays = (roomId: string) =>
  useQuery<Replay[]>({
    queryKey: recordingKeys.room(roomId),
    queryFn: () => recordingService.forRoom(roomId),
    enabled: roomId.length > 0,
  });
