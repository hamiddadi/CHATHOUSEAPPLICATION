import { useCallback } from 'react';
import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { env } from '../../../config/env';
import { roomService, FEED_PAGE_SIZE, type CreateRoomInput } from '../services/roomService';
import type { Room, RoomSummary } from '../../../shared/types/domain';
import { useCurrentRoomStore } from '../store/currentRoomStore';

export const roomKeys = {
  all: ['rooms'] as const,
  list: () => [...roomKeys.all, 'list'] as const,
  detail: (id: string) => [...roomKeys.all, 'detail', id] as const,
  history: () => [...roomKeys.all, 'history', 'mine'] as const,
  handRaises: (id: string) => [...roomKeys.all, 'hand-raises', id] as const,
};

export const useMyRoomHistory = (limit = 20) =>
  useQuery<RoomSummary[]>({
    queryKey: roomKeys.history(),
    queryFn: () => roomService.myHistory(limit),
    // The history only changes when the user ends a room; 5 minutes
    // of cache is safe and cuts down on refetches while scrolling.
    staleTime: 5 * 60_000,
  });

export interface RoomsFilter {
  topic?: string;
  following?: boolean;
  clubs?: boolean;
}

export const useRooms = (filter: RoomsFilter = {}) =>
  useInfiniteQuery({
    queryKey: [...roomKeys.list(), filter],
    queryFn: ({ pageParam }) => roomService.list(filter, pageParam),
    initialPageParam: 0,
    // A full page means the ranked pool may hold more → request the next slice
    // at offset = pagesSoFar × pageSize. A short page ends the scroll.
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length === FEED_PAGE_SIZE ? allPages.length * FEED_PAGE_SIZE : undefined,
    // Keep the previously-fetched feed on screen while a new filter loads so
    // switching pills doesn't flash the skeleton.
    placeholderData: keepPreviousData,
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

export const useLowerHand = () =>
  useMutation({ mutationFn: (roomId: string) => roomService.lowerHand(roomId) });

export const useSetMute = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      roomId,
      isMuted,
      userId,
    }: {
      roomId: string;
      isMuted: boolean;
      userId?: string;
    }) => roomService.setMute(roomId, isMuted, userId),
    // Reflect the new mute state in the room detail. With realtime on the
    // `room:mute-changed` socket event already does this; this keeps the UI in
    // sync when realtime is off (the demo/dev config), where there's no socket.
    onSuccess: (_res, vars) => {
      void qc.invalidateQueries({ queryKey: roomKeys.detail(vars.roomId) });
    },
  });
};

export const useSetRole = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      roomId,
      userId,
      role,
    }: {
      roomId: string;
      userId: string;
      role: 'HOST' | 'MODERATOR' | 'SPEAKER' | 'LISTENER';
    }) => roomService.setRole(roomId, userId, role),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: roomKeys.detail(vars.roomId) });
    },
  });
};

export const useKickFromRoom = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      roomId,
      userId,
      banMinutes,
      reason,
    }: {
      roomId: string;
      userId: string;
      banMinutes?: number;
      reason?: string;
    }) => roomService.kick(roomId, userId, { banMinutes, reason }),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: roomKeys.detail(vars.roomId) });
    },
  });
};

export const useEndRoom = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (roomId: string) => roomService.end(roomId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: roomKeys.list() });
    },
  });
};

export const useReportRoom = () =>
  useMutation({
    mutationFn: ({
      roomId,
      reason,
      details,
    }: {
      roomId: string;
      reason: 'spam' | 'harassment' | 'fake_profile' | 'other';
      details?: string;
    }) => roomService.report(roomId, { reason, details }),
  });

export const useHandRaises = (roomId: string | null) =>
  useQuery({
    queryKey: roomKeys.handRaises(roomId ?? ''),
    queryFn: () => roomService.listHandRaises(roomId as string),
    enabled: Boolean(roomId),
    // When realtime is on, useRoomSocket invalidates roomKeys.handRaises on
    // hand_raised/lowered, so the interval would be duplicate work — disable it.
    // Otherwise poll every 10s, but never while the app is backgrounded.
    refetchInterval: env.REALTIME_ENABLED ? false : 10_000,
    refetchIntervalInBackground: false,
  });

export const useRoomMessages = (roomId: string | null) =>
  useQuery({
    queryKey: [...roomKeys.all, 'messages', roomId ?? ''] as const,
    queryFn: () => roomService.listMessages(roomId as string),
    enabled: Boolean(roomId),
  });

export const useSendRoomMessage = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      roomId,
      content,
      replyToId,
    }: {
      roomId: string;
      content: string;
      replyToId?: string;
    }) => roomService.sendMessage(roomId, content, replyToId),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({
        queryKey: [...roomKeys.all, 'messages', vars.roomId] as const,
      });
    },
  });
};

export const useSendReaction = () =>
  useMutation({
    mutationFn: ({ roomId, emoji }: { roomId: string; emoji: string }) =>
      roomService.sendReaction(roomId, emoji),
  });

export const useUpdateRoomTitle = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ roomId, title }: { roomId: string; title: string }) =>
      roomService.updateTitle(roomId, title),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: roomKeys.detail(vars.roomId) });
    },
  });
};

export const useToggleRoomChat = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      roomId,
      chatEnabled,
      chatVisibility,
    }: {
      roomId: string;
      chatEnabled?: boolean;
      chatVisibility?: 'all' | 'mods';
    }) => roomService.toggleChat(roomId, { chatEnabled, chatVisibility }),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: roomKeys.detail(vars.roomId) });
    },
  });
};

export const useMuteAllInRoom = () =>
  useMutation({
    mutationFn: ({ roomId, includeHost }: { roomId: string; includeHost?: boolean }) =>
      roomService.muteAll(roomId, includeHost ?? false),
  });

export const useInviteToRoom = () =>
  useMutation({
    mutationFn: ({ roomId, userIds }: { roomId: string; userIds: readonly string[] }) =>
      roomService.invite(roomId, userIds),
  });

export const usePingUserToRoom = () =>
  useMutation({
    mutationFn: ({ targetUserId, roomId }: { targetUserId: string; roomId: string }) =>
      roomService.ping(targetUserId, roomId),
  });

/**
 * Convenience hook exposing the global "current room" state for the
 * mini-bar and any component that needs to know whether the user is
 * currently in a room. Combines the Zustand store with the leave mutation.
 */
export const useCurrentRoom = () => {
  const room = useCurrentRoomStore(s => s.room);
  const isMuted = useCurrentRoomStore(s => s.isMuted);
  const storeToggleMute = useCurrentRoomStore(s => s.toggleMute);
  const clearRoom = useCurrentRoomStore(s => s.clear);
  const leaveRoom = useLeaveRoom();
  const setMute = useSetMute();

  // Real mute toggle: flip local state optimistically, persist to the server
  // so other participants see it, and roll back on failure. The server
  // broadcasts `room:mute-changed` which the `roomAudioService` listens for
  // and calls `setLiveKitMuted` on the active room — so the SDK-level mute
  // happens automatically via the socket event flow.
  const toggleMute = useCallback(() => {
    if (!room) return;
    const next = !useCurrentRoomStore.getState().isMuted;
    storeToggleMute();
    setMute.mutate({ roomId: room.id, isMuted: next }, { onError: () => storeToggleMute() });
  }, [room, setMute, storeToggleMute]);

  const leave = () => {
    if (room) {
      leaveRoom.mutate(room.id);
    }
    clearRoom();
  };

  return { room, isMuted, toggleMute, leave };
};
