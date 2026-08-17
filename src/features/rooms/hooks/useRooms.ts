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
import type { ContentReportReason } from '../../../shared/types/moderation';
import { useCurrentRoomStore } from '../store/currentRoomStore';
import { roomAudioSession } from '../services/roomAudioSession';
import { createIdempotencyKey } from '../../../shared/utils/idempotency';
import { retryTransientMutation } from '../../../shared/services/api/retryPolicy';

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

export const useRoom = (roomId: string, enabled = true) =>
  useQuery<Room>({
    queryKey: roomKeys.detail(roomId),
    queryFn: () => roomService.get(roomId),
    enabled: enabled && roomId.length > 0,
  });

// Public scheduled rooms a given user is hosting — drives the profile's
// "Events à venir" section (works for any viewed user, not just self).
export const useUserUpcomingEvents = (userId: string) =>
  useQuery<RoomSummary[]>({
    queryKey: [...roomKeys.all, 'user-upcoming', userId],
    queryFn: () => roomService.userUpcoming(userId),
    enabled: userId.length > 0,
    staleTime: 60_000,
  });

export const useCreateRoom = () => {
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: ({ input, idempotencyKey }: { input: CreateRoomInput; idempotencyKey: string }) =>
      roomService.create(input, idempotencyKey),
    retry: retryTransientMutation,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: roomKeys.list() });
    },
  });
  const withKey = (input: CreateRoomInput) => ({ input, idempotencyKey: createIdempotencyKey() });
  return {
    ...mutation,
    mutate: (input: CreateRoomInput, options?: Parameters<typeof mutation.mutate>[1]) =>
      mutation.mutate(withKey(input), options),
    mutateAsync: (input: CreateRoomInput, options?: Parameters<typeof mutation.mutateAsync>[1]) =>
      mutation.mutateAsync(withKey(input), options),
  };
};

export const useJoinRoom = () =>
  useMutation({ mutationFn: (roomId: string) => roomService.join(roomId) });

export const useLeaveRoom = () =>
  useMutation({ mutationFn: (roomId: string) => roomService.leave(roomId) });

export const useRaiseHand = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (roomId: string) => roomService.raiseHand(roomId),
    onSuccess: (_data, roomId) => {
      // Do not rely exclusively on Socket.IO: a REST success while realtime is
      // reconnecting must still reconcile the local queue/button.
      void qc.invalidateQueries({ queryKey: roomKeys.handRaises(roomId) });
      void qc.invalidateQueries({ queryKey: roomKeys.detail(roomId) });
    },
  });
};

export const useLowerHand = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (roomId: string) => roomService.lowerHand(roomId),
    onSuccess: (_data, roomId) => {
      void qc.invalidateQueries({ queryKey: roomKeys.handRaises(roomId) });
      void qc.invalidateQueries({ queryKey: roomKeys.detail(roomId) });
    },
  });
};

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
  const mutation = useMutation({
    mutationFn: ({
      roomId,
      content,
      replyToId,
      idempotencyKey,
    }: {
      roomId: string;
      content: string;
      replyToId?: string;
      idempotencyKey: string;
    }) => roomService.sendMessage(roomId, content, idempotencyKey, replyToId),
    retry: retryTransientMutation,
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({
        queryKey: [...roomKeys.all, 'messages', vars.roomId] as const,
      });
    },
  });
  type Variables = { roomId: string; content: string; replyToId?: string };
  const withKey = (variables: Variables) => ({
    ...variables,
    idempotencyKey: createIdempotencyKey(),
  });
  return {
    ...mutation,
    mutate: (variables: Variables, options?: Parameters<typeof mutation.mutate>[1]) =>
      mutation.mutate(withKey(variables), options),
    mutateAsync: (variables: Variables, options?: Parameters<typeof mutation.mutateAsync>[1]) =>
      mutation.mutateAsync(withKey(variables), options),
  };
};

export const useReportRoomMessage = () =>
  useMutation({
    mutationFn: ({
      roomId,
      messageId,
      reason,
    }: {
      roomId: string;
      messageId: string;
      reason: ContentReportReason;
    }) => roomService.reportMessage(roomId, messageId, reason),
  });

export const useSendReaction = () => {
  const mutation = useMutation({
    mutationFn: ({
      roomId,
      emoji,
      idempotencyKey,
    }: {
      roomId: string;
      emoji: string;
      idempotencyKey: string;
    }) => roomService.sendReaction(roomId, emoji, idempotencyKey),
    retry: retryTransientMutation,
  });
  type Variables = { roomId: string; emoji: string };
  const withKey = (variables: Variables) => ({
    ...variables,
    idempotencyKey: createIdempotencyKey(),
  });
  return {
    ...mutation,
    mutate: (variables: Variables, options?: Parameters<typeof mutation.mutate>[1]) =>
      mutation.mutate(withKey(variables), options),
    mutateAsync: (variables: Variables, options?: Parameters<typeof mutation.mutateAsync>[1]) =>
      mutation.mutateAsync(withKey(variables), options),
  };
};

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

export const useLockRoom = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ roomId, locked }: { roomId: string; locked: boolean }) =>
      roomService.setLock(roomId, locked),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: roomKeys.detail(vars.roomId) });
    },
  });
};

// #32: toggle the viewer's invisible/ghost state in the room.
export const useSetHidden = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ roomId, hidden }: { roomId: string; hidden: boolean }) =>
      roomService.setHidden(roomId, hidden),
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
    // Tear down the persistent audio session (the engine outlives the screen,
    // so it must be stopped explicitly on a real leave — not on unmount).
    void roomAudioSession.stop();
  };

  return { room, isMuted, toggleMute, leave };
};
