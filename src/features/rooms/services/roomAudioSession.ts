/**
 * roomAudioSession — the SINGLE owner of the live LiveKit audio handle.
 *
 * The handle lives here, in a module-level singleton, NOT inside a
 * screen-mounted hook. That decoupling is what makes audio survive navigating
 * away from RoomScreen (the mini-bar keeps playing) and survive backgrounding
 * (together with the Android foreground service started inside
 * {@link startRoomAudio}). The session is torn down ONLY on an explicit leave
 * (`stop()`), never on a React unmount.
 *
 * `useRoomAudio` is now a thin subscriber: it asks the session to `start()` the
 * room (idempotent) and reads reactive state from {@link useRoomAudioStore}.
 * The session's callbacks write straight into that store, so live "who's
 * speaking" / connection state keep flowing even while RoomScreen is unmounted.
 */
import { create } from 'zustand';
import type { Socket } from 'socket.io-client';
import { getSocket } from '../../../shared/services/realtime/socketClient';
import { errorMessage } from '../../../shared/utils/errorMessage';
import { useAuthStore } from '../../auth/store/authStore';
import { useCurrentRoomStore } from '../store/currentRoomStore';
import { startRoomAudio, type RoomAudioHandle } from './roomAudioService';

export type RoomAudioStatus =
  | 'idle'
  | 'connecting'
  | 'live'
  | 'reconnecting'
  | 'error'
  | 'unsupported';

interface RoomAudioState {
  /** The room the engine is currently bound to (null = no active session). */
  roomId: string | null;
  status: RoomAudioStatus;
  error: string | null;
  /** Per-user "is speaking" (1) / silent (0). Self is keyed under SELF_KEY. */
  scores: ReadonlyMap<string, number>;
}

export const SELF_KEY = '__self__';
const SPEAKING_THRESHOLD = 0.5;
const EMPTY_SCORES: ReadonlyMap<string, number> = new Map();

export const useRoomAudioStore = create<RoomAudioState>(() => ({
  roomId: null,
  status: 'idle',
  error: null,
  scores: EMPTY_SCORES,
}));

let handle: RoomAudioHandle | null = null;
// The room we're currently bound to (or starting). Guards against double-start
// and lets an in-flight start detect that a stop()/switch raced ahead of it.
let boundRoomId: string | null = null;
let startInFlight: Promise<void> | null = null;

const setScore = (key: string, speaking: boolean): void => {
  useRoomAudioStore.setState(s => {
    const value = speaking ? 1 : 0;
    // ActiveSpeakersChanged ticks re-report unchanged levels continuously;
    // skip the state write (and the resulting full re-render of every
    // scores subscriber) when nothing actually changed.
    if (s.scores.get(key) === value) return {};
    const next = new Map(s.scores);
    next.set(key, value);
    return { scores: next };
  });
};

const dropScore = (key: string): void => {
  useRoomAudioStore.setState(s => {
    if (!s.scores.has(key)) return {};
    const next = new Map(s.scores);
    next.delete(key);
    return { scores: next };
  });
};

// ─── Session-level room lifecycle ────────────────────────────────────
// `room:ended` / `room:user_kicked` must be honoured even while RoomScreen is
// UNMOUNTED (the user navigated away and only the mini-bar remains) — the
// screen-level listeners die with the screen, so without this the LiveKit
// audio and the mini-bar survived the host closing the room. Bound for the
// lifetime of the audio session; torn down in stop().
let roomLifecycleCleanup: (() => void) | null = null;

const bindRoomLifecycle = (socket: Socket, roomId: string): void => {
  roomLifecycleCleanup?.();
  const endSession = (): void => {
    useCurrentRoomStore.getState().clear(); // drop the mini-bar
    void roomAudioSession.stop(); // stop LiveKit + foreground service
  };
  const endedHandler = (payload?: { roomId?: string }): void => {
    if (payload?.roomId && payload.roomId !== roomId) return;
    endSession();
  };
  const kickedHandler = (payload?: { userId?: string; roomId?: string }): void => {
    if (!payload || payload.userId !== useAuthStore.getState().user?.id) return;
    if (payload.roomId && payload.roomId !== roomId) return;
    endSession();
  };
  socket.on('room:ended', endedHandler);
  socket.on('room:user_kicked', kickedHandler);
  roomLifecycleCleanup = () => {
    socket.off('room:ended', endedHandler);
    socket.off('room:user_kicked', kickedHandler);
    roomLifecycleCleanup = null;
  };
};

export const roomAudioSession = {
  /**
   * Ensure the audio engine is connected to `roomId`. Idempotent for the same
   * room; switching rooms tears the previous session down first. Safe to call
   * repeatedly (e.g. every RoomScreen mount / mini-bar resume).
   */
  async start(roomId: string): Promise<void> {
    if (!roomId) return;
    // Already live (or starting) for this exact room → nothing to do.
    if (boundRoomId === roomId && (handle || startInFlight)) {
      return startInFlight ?? Promise.resolve();
    }
    // Switching rooms: drop the old session first.
    if (boundRoomId && boundRoomId !== roomId) await this.stop();

    boundRoomId = roomId;
    useRoomAudioStore.setState({
      roomId,
      status: 'connecting',
      error: null,
      scores: new Map(),
    });

    startInFlight = (async () => {
      try {
        const socket = await getSocket();
        if (!socket) throw new Error('socket not connected');
        // Bind BEFORE the (slow) LiveKit connect, and even if it later throws
        // (mic denied → the user stays in the room as a listener): the
        // room-closed/kicked teardown must work in both cases. Guarded on
        // boundRoomId so a stop()/switch that raced ahead doesn't get its
        // fresh listeners clobbered by this stale start.
        if (boundRoomId === roomId) bindRoomLifecycle(socket, roomId);
        const h = await startRoomAudio({
          socket,
          roomId,
          onLocalScore: level => setScore(SELF_KEY, level >= SPEAKING_THRESHOLD),
          onPeerScore: ev => setScore(ev.userId, ev.speaking || ev.volume >= SPEAKING_THRESHOLD),
          onPeerGone: userId => dropScore(userId),
          onStatusChange: next => {
            useRoomAudioStore.setState(s => {
              if (s.roomId !== roomId) return {};
              if (s.status === 'error' || s.status === 'unsupported' || s.status === 'idle') {
                return {};
              }
              return { status: next === 'connected' ? 'live' : 'reconnecting' };
            });
          },
        });
        // A stop()/switch happened while we were connecting — discard.
        if (boundRoomId !== roomId) {
          await h.close();
          return;
        }
        handle = h;
        useRoomAudioStore.setState(s => (s.roomId === roomId ? { status: 'live' } : {}));
      } catch (err) {
        const msg = errorMessage(err, 'unknown');
        const status: RoomAudioStatus = msg.includes('@livekit/react-native not installed')
          ? 'unsupported'
          : 'error';
        useRoomAudioStore.setState(s => (s.roomId === roomId ? { status, error: msg } : {}));
      } finally {
        if (boundRoomId === roomId) startInFlight = null;
      }
    })();

    return startInFlight;
  },

  /** Tear the session down. Call on an explicit leave / kick / room-end. */
  async stop(): Promise<void> {
    boundRoomId = null;
    startInFlight = null;
    roomLifecycleCleanup?.();
    const h = handle;
    handle = null;
    useRoomAudioStore.setState({ roomId: null, status: 'idle', error: null, scores: new Map() });
    if (h) await h.close();
  },

  async setMuted(muted: boolean): Promise<void> {
    await handle?.setMuted(muted);
  },

  setPeerVolume(userId: string, volume: number): void {
    handle?.setPeerVolume(userId, volume);
  },
};
