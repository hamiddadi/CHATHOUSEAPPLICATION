import { create } from 'zustand';
import type { RoomParticipant } from '../../../shared/types/domain';

/**
 * Lightweight global state for the "current room" the user is sitting in.
 * Drives the mini-bar component that persists across tab navigation.
 *
 * Set on room:join, cleared on room:leave / disconnect.
 */

interface CurrentRoomState {
  room: {
    id: string;
    title: string;
    speakers: RoomParticipant[];
    listenersCount: number;
  } | null;
  isMuted: boolean;

  setRoom: (room: CurrentRoomState['room']) => void;
  updateSpeakers: (speakers: RoomParticipant[]) => void;
  updateListenersCount: (count: number) => void;
  toggleMute: () => void;
  // Explicit setter so the RoomScreen can keep this store (the source of
  // truth the audio engine reads when restoring mute after a token renewal /
  // reconnect) in sync with the real local mute state. Without this, the
  // store stayed at its `false` default and a reconnect hot-unmuted the user.
  setMuted: (muted: boolean) => void;
  // Single reset action used after room:leave / disconnect. Previously this
  // store exposed identical `leave` and `clear` actions; `clear` is kept as
  // the canonical name (its only consumer is useCurrentRoom) and the `leave`
  // duplicate was removed to avoid ambiguity over which to call.
  clear: () => void;
}

export const useCurrentRoomStore = create<CurrentRoomState>(set => ({
  room: null,
  isMuted: false,

  setRoom: room => set({ room, isMuted: false }),

  updateSpeakers: speakers => set(s => (s.room ? { room: { ...s.room, speakers } } : {})),

  updateListenersCount: count =>
    set(s => (s.room ? { room: { ...s.room, listenersCount: count } } : {})),

  toggleMute: () => set(s => ({ isMuted: !s.isMuted })),

  setMuted: muted => set({ isMuted: muted }),

  clear: () => set({ room: null, isMuted: false }),
}));
