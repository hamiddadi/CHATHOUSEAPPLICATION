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
  /**
   * SINGLE source of truth for the viewer's mute state. RoomScreen, the
   * mini-bar AND roomAudioService (which re-applies it after a LiveKit token
   * renew / rejoin) all read this value — a screen-local copy would silently
   * diverge after a reconnect.
   */
  isMuted: boolean;

  setRoom: (room: CurrentRoomState['room']) => void;
  updateSpeakers: (speakers: RoomParticipant[]) => void;
  updateListenersCount: (count: number) => void;
  setMuted: (isMuted: boolean) => void;
  toggleMute: () => void;
  // Single reset action used after room:leave / disconnect. Previously this
  // store exposed identical `leave` and `clear` actions; `clear` is kept as
  // the canonical name (its only consumer is useCurrentRoom) and the `leave`
  // duplicate was removed to avoid ambiguity over which to call.
  clear: () => void;
}

export const useCurrentRoomStore = create<CurrentRoomState>(set => ({
  room: null,
  isMuted: false,

  // Deliberately does NOT touch `isMuted`: setRoom re-runs on every room
  // detail refetch, and resetting the flag here silently re-opened the mic
  // after a LiveKit token renew/rejoin while the badge still showed "muted".
  // The mute lifecycle is: hydrated on room ENTRY (RoomScreen), flipped by
  // setMuted/toggleMute, reset only by clear().
  setRoom: room => set({ room }),

  updateSpeakers: speakers => set(s => (s.room ? { room: { ...s.room, speakers } } : {})),

  updateListenersCount: count =>
    set(s => (s.room ? { room: { ...s.room, listenersCount: count } } : {})),

  setMuted: isMuted => set({ isMuted }),

  toggleMute: () => set(s => ({ isMuted: !s.isMuted })),

  clear: () => set({ room: null, isMuted: false }),
}));
