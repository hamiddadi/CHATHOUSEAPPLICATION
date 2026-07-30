/**
 * roomAudioService — WebRTC audio backend for ChatHouse rooms.
 *
 * This file is the SINGLE seam between the audio engine and the rest of
 * the app. The engine of record is **LiveKit** (`@livekit/react-native`);
 * the Agora pipeline that lived here previously was retired in favour of
 * an open-source self-hosted SFU. The contract — `startRoomAudio({ socket, roomId })`
 * returning a `RoomAudioHandle` — is preserved verbatim, so `useRoomAudio`,
 * RoomScreen, HostActionsSheet, RoomChatSidebar, ReactionsBar, etc. keep
 * working without a single line changed.
 *
 * Why preserve the socket parameter when LiveKit handles its own signaling?
 *   - The socket is still the source of truth for ROLE state (HOST /
 *     MODERATOR / SPEAKER / LISTENER). We listen for `room:role_changed`
 *     to reconnect with a new token if the role changes (canPublish flip).
 *   - LiveKit uses string identities — our userId maps directly as the
 *     participant identity, no hashing needed.
 */

import type { Socket } from 'socket.io-client';
import { useAuthStore } from '../../auth/store/authStore';
import { useCurrentRoomStore } from '../store/currentRoomStore';
import { requestAudioPermission } from '../../../shared/utils/permissions';
import { roomService } from './roomService';
import {
  LIVEKIT_UNAVAILABLE_SENTINEL,
  createLiveKitRoom,
  connectLiveKitRoom,
  disconnectLiveKitRoom,
  getLiveKitEvents,
  mapLiveKitConnectionState,
  setLiveKitMuted,
  startLiveKitAudioSession,
  stopLiveKitAudioSession,
  type LiveKitRoom,
  type LiveKitParticipant,
} from './livekit/LiveKitEngine';
import { startRoomForeground, stopRoomForeground } from './foregroundAudio';

// Re-exported for `useRoomAudio` to detect the "missing native module" path.
export const SKELETON_SENTINEL = LIVEKIT_UNAVAILABLE_SENTINEL;

// Stable error message thrown when the RECORD_AUDIO permission is refused.
// RoomScreen matches on it to swap the raw error banner for a localized
// "mic denied" message with an "open settings" CTA (the user stays in the
// room as a listener — audio capture simply never starts).
export const MIC_PERMISSION_DENIED_ERROR = 'mic permission denied';

export interface PeerInfo {
  userId: string;
  /** Normalised volume: 0..1. */
  volume?: number;
  /** Voice-Activity-Detection: 1 when the speaker is actually speaking. */
  vad?: 0 | 1;
}

export interface RoomAudioHandle {
  /** Stop producing + leave the LiveKit room. */
  close: () => Promise<void>;
  /** Mute or unmute the local mic. */
  setMuted: (muted: boolean) => Promise<void>;
  /**
   * Per-peer volume control. LiveKit doesn't expose a per-peer playback
   * volume API at the SDK level — this is a no-op placeholder for API
   * compatibility. Individual track volume can be controlled at the
   * native player level if needed in the future.
   */
  setPeerVolume: (userId: string, volume: number) => void;
  /** Update the local client role mid-session (host promote/demote). */
  setRole: (role: 'host' | 'audience') => Promise<void>;
  /** Map of peers currently audible, keyed by userId. */
  getPeers: () => ReadonlyMap<string, PeerInfo>;
}

export interface AudioLevelEvent {
  userId: string;
  /** Normalised 0..1 volume. */
  volume: number;
  /** True when the participant is actively speaking. */
  speaking: boolean;
}

/**
 * Live connection status of the underlying LiveKit room, derived from the
 * SDK's connection state. The hook maps this onto its own `status` field
 * so a UI banner can show a "reconnecting…" state:
 *   - `connected`     → room is up, audio flowing
 *   - `reconnecting`  → SDK lost the link and is auto-retrying (transient)
 *   - `failed`        → SDK gave up; we kick a bounded manual rejoin
 */
export type AudioConnectionStatus = 'connected' | 'reconnecting' | 'failed';

interface StartOptions {
  socket: Socket;
  roomId: string;
  /** Logical cancellation owned by the singleton session during stop/switch. */
  isCancelled?: () => boolean;
  /** Triggered when a remote user joins the room. */
  onPeerJoined?: (info: PeerInfo) => void;
  /** Triggered when a remote user leaves. */
  onPeerGone?: (userId: string) => void;
  /** Local mic level — 0..1. Drives the self-speaking indicator. */
  onLocalScore?: (level: number) => void;
  /** Per-peer audio level — drives the "who's speaking" UI. */
  onPeerScore?: (event: AudioLevelEvent) => void;
  /**
   * Connection-state transitions from the LiveKit SDK. Optional — when the
   * native module is absent (Expo Go) this never fires, so the unsupported
   * path stays a no-op.
   */
  onStatusChange?: (status: AudioConnectionStatus) => void;
}

/**
 * Start participating in a room's audio. Returns a handle the
 * `useRoomAudio` hook stores in a ref.
 */
export const startRoomAudio = async ({
  socket,
  roomId,
  onPeerJoined,
  onPeerGone,
  onLocalScore,
  onPeerScore,
  onStatusChange,
  isCancelled,
}: StartOptions): Promise<RoomAudioHandle> => {
  // Create a new LiveKit Room instance. Throws SKELETON_SENTINEL when
  // `@livekit/react-native` isn't installed (Expo Go) — useRoomAudio
  // catches that and surfaces `status: 'unsupported'`.
  let room: LiveKitRoom;
  try {
    room = createLiveKitRoom();
  } catch (e) {
    throw e;
  }

  const events = getLiveKitEvents();

  // Resolve the local user. We need their userId for identity matching.
  const me = useAuthStore.getState().user;
  if (!me?.id) throw new Error('user not authenticated');

  // Determine initial role from the participant list embedded in the
  // socket "room:participants" event we'll receive on join. Until that
  // arrives, default to audience — the server will broadcast role_changed
  // if we're actually a speaker.
  let currentRole: 'host' | 'audience' = 'audience';

  const peers = new Map<string, PeerInfo>();

  const emitJoin = (userId: string): void => {
    if (peers.has(userId)) return;
    const info: PeerInfo = { userId };
    peers.set(userId, info);
    onPeerJoined?.(info);
  };

  const emitLeave = (userId: string): void => {
    if (!peers.delete(userId)) return;
    onPeerGone?.(userId);
  };

  // ─── Token policy ─────────────────────────────────────────────────
  // Fetch a signed LiveKit token from the backend (room = roomId,
  // identity = userId, canPublish based on role).
  const fetchToken = async (): Promise<{
    token: string;
    url: string;
    canPublish: boolean;
    expiresAtMs: number | null;
  }> => {
    const r = await roomService.getLivekitToken(roomId);
    return {
      token: r.token,
      url: r.url,
      canPublish: r.canPublish,
      expiresAtMs: new Date(r.expiresAt).getTime(),
    };
  };

  // ─── Auto-reconnect state ─────────────────────────────────────────
  // LiveKit handles most reconnection internally. We add a manual
  // rejoin layer for hard failures (token expired, server restart).
  const MAX_REJOIN_ATTEMPTS = 5;
  let closed = false;
  let rejoinInFlight = false;
  let rejoinAttempts = 0;
  let rejoinTimer: ReturnType<typeof setTimeout> | null = null;
  let renewTimer: ReturnType<typeof setTimeout> | null = null;
  let lastStatus: AudioConnectionStatus | null = null;
  const inactive = (): boolean => closed || Boolean(isCancelled?.());
  const throwIfInactive = (): void => {
    if (inactive()) throw new Error('room audio start cancelled');
  };

  const scheduleRenewal = (expiresAtMs: number | null): void => {
    if (renewTimer) clearTimeout(renewTimer);
    if (!expiresAtMs) return;
    const msUntilExpiry = expiresAtMs - Date.now();
    const lead = msUntilExpiry > 60_000 ? 30_000 : Math.max(5_000, msUntilExpiry / 2);
    const delay = Math.max(0, msUntilExpiry - lead);
    renewTimer = setTimeout(() => {
      void (async () => {
        try {
          if (inactive()) return;
          // For LiveKit, token renewal requires a reconnect with the
          // new token. We disconnect and reconnect.
          const next = await fetchToken();
          if (inactive()) return;
          disconnectLiveKitRoom(room);
          await connectLiveKitRoom(room, next.url, next.token);
          if (inactive()) {
            disconnectLiveKitRoom(room);
            return;
          }
          scheduleRenewal(next.expiresAtMs);
          if (next.canPublish) {
            const isMuted = useCurrentRoomStore.getState().isMuted;
            await setLiveKitMuted(room, isMuted);
          }
        } catch {
          // Renewal failed — LiveKit will eventually disconnect and
          // the reconnection handler will kick in.
        }
      })();
    }, delay);
  };

  const attemptRejoin = (): void => {
    if (inactive() || rejoinInFlight) return;
    if (rejoinAttempts >= MAX_REJOIN_ATTEMPTS) return;
    rejoinInFlight = true;
    rejoinAttempts += 1;
    const backoff = Math.min(30_000, 2_000 * 2 ** (rejoinAttempts - 1));
    if (rejoinTimer) clearTimeout(rejoinTimer);
    rejoinTimer = setTimeout(() => {
      void (async () => {
        try {
          if (inactive()) return;
          const next = await fetchToken();
          if (inactive()) return;
          await connectLiveKitRoom(room, next.url, next.token);
          if (inactive()) {
            disconnectLiveKitRoom(room);
            return;
          }
          scheduleRenewal(next.expiresAtMs);
          if (next.canPublish) {
            const isMuted = useCurrentRoomStore.getState().isMuted;
            await setLiveKitMuted(room, isMuted);
          }
        } catch {
          // This attempt failed; if the SDK fires Disconnected again
          // we'll get another shot until the budget runs out.
        } finally {
          rejoinInFlight = false;
        }
      })();
    }, backoff);
  };

  // ─── LiveKit event handlers ───────────────────────────────────────

  const handleParticipantConnected = (participant: LiveKitParticipant): void => {
    emitJoin(participant.identity);
  };

  const handleParticipantDisconnected = (participant: LiveKitParticipant): void => {
    emitLeave(participant.identity);
  };

  const handleActiveSpeakersChanged = (speakers: LiveKitParticipant[]): void => {
    // LiveKit provides a list of currently active speakers with their
    // audio levels. We process this similar to Agora's volume indication.
    const speakerIdentities = new Set(speakers.map(s => s.identity));

    for (const speaker of speakers) {
      const isLocal = speaker.identity === me.id;
      const volumeNorm = Math.min(1, speaker.audioLevel);

      if (isLocal) {
        // Use LiveKit's own voice-activity flag (isSpeaking) as the primary
        // signal — the raw audioLevel peaks well below the score threshold for
        // many mics/devices (≈0.4), so a level-only check would never light the
        // speaking ring. Fall back to the normalized level when the flag is off.
        onLocalScore?.(speaker.isSpeaking ? 1 : volumeNorm);
        continue;
      }

      const peer = peers.get(speaker.identity);
      if (peer) {
        peer.volume = Math.round(volumeNorm * 255);
        peer.vad = speaker.isSpeaking ? 1 : 0;
      }

      onPeerScore?.({
        userId: speaker.identity,
        volume: volumeNorm,
        speaking: speaker.isSpeaking,
      });
    }

    // Mark peers that stopped speaking (not in active speakers list)
    for (const [userId, peer] of peers) {
      if (!speakerIdentities.has(userId)) {
        if (peer.vad === 1) {
          peer.vad = 0;
          peer.volume = 0;
          onPeerScore?.({
            userId,
            volume: 0,
            speaking: false,
          });
        }
      }
    }
  };

  const handleConnectionStateChanged = (state: string): void => {
    const status = mapLiveKitConnectionState(state);
    if (status !== lastStatus) {
      lastStatus = status;
      onStatusChange?.(status);
    }
    if (status === 'connected') {
      if (rejoinTimer) {
        clearTimeout(rejoinTimer);
        rejoinTimer = null;
      }
      rejoinAttempts = 0;
      return;
    }
    if (status === 'failed') {
      attemptRejoin();
    }
  };

  const handleDisconnected = (): void => {
    if (!closed) {
      handleConnectionStateChanged('disconnected');
    }
  };

  const handleReconnecting = (): void => {
    handleConnectionStateChanged('reconnecting');
  };

  const handleReconnected = (): void => {
    handleConnectionStateChanged('connected');
  };

  // ─── Socket bindings — keep role consistent ───────────────────────
  // When the server announces a user's join/role, we update our state.
  // LiveKit identities = userIds, so no binding map needed.
  interface SocketJoinPayload {
    userId: string;
    roomId: string;
  }
  const handleSocketJoin = (payload: SocketJoinPayload | undefined): void => {
    if (!payload || payload.roomId !== roomId) return;
    // Pre-populate the peer if they haven't appeared via LiveKit yet
    emitJoin(payload.userId);
  };

  interface SocketRolePayload {
    userId: string;
    role: string;
    roomId: string;
  }
  const handleSocketRoleChange = async (payload: SocketRolePayload | undefined): Promise<void> => {
    if (!payload || payload.roomId !== roomId) return;
    if (payload.userId !== me.id) return;
    const next: 'host' | 'audience' =
      payload.role === 'HOST' || payload.role === 'MODERATOR' || payload.role === 'SPEAKER'
        ? 'host'
        : 'audience';
    if (next === currentRole) return;
    // Role change requires a new token with updated canPublish.
    // Reconnect with a fresh token.
    try {
      const fresh = await fetchToken();
      if (inactive()) return;
      if (fresh.canPublish && !(await requestAudioPermission())) {
        // Keep the existing receive-only connection. A later role event or
        // explicit retry can request the permission again.
        return;
      }
      if (inactive()) return;
      disconnectLiveKitRoom(room);
      await connectLiveKitRoom(room, fresh.url, fresh.token);
      if (inactive()) {
        disconnectLiveKitRoom(room);
        return;
      }
      currentRole = next;
      scheduleRenewal(fresh.expiresAtMs);
      if (fresh.canPublish) {
        const isMuted = useCurrentRoomStore.getState().isMuted;
        await setLiveKitMuted(room, isMuted);
      }
    } catch {
      /* failed to reconnect with new role — will retry on next role change */
    }
  };

  // Host/mod force-mute → flip the local LiveKit mic too.
  interface SocketMutePayload {
    userId: string;
    isMuted: boolean;
    roomId?: string;
  }
  const handleSocketMuteChanged = async (payload: SocketMutePayload | undefined): Promise<void> => {
    if (!payload || (payload.roomId && payload.roomId !== roomId)) return;
    if (payload.userId !== me.id) return; // only act on self
    if (inactive()) return;
    await setLiveKitMuted(room, payload.isMuted);
  };

  // Startup is transactional. Every listener registers its inverse before the
  // potentially-throwing `.on()` call, so even a partial handler setup is
  // reversible. The same cleanup owns both failed startup and the successful
  // handle's close path; concurrent/repeated closes share one promise.
  const listenerCleanups: Array<() => void> = [];
  let cleanupPromise: Promise<void> | null = null;

  const bindListener = (subscribe: () => void, unsubscribe: () => void): void => {
    listenerCleanups.push(unsubscribe);
    subscribe();
  };

  const cleanupResources = (): Promise<void> => {
    if (cleanupPromise) return cleanupPromise;
    closed = true;
    cleanupPromise = (async () => {
      if (renewTimer) {
        clearTimeout(renewTimer);
        renewTimer = null;
      }
      if (rejoinTimer) {
        clearTimeout(rejoinTimer);
        rejoinTimer = null;
      }

      for (const removeListener of listenerCleanups.splice(0).reverse()) {
        try {
          removeListener();
        } catch {
          // Cleanup is best-effort per listener; one native emitter failure
          // must not prevent the room/audio session from being released.
        }
      }

      try {
        disconnectLiveKitRoom(room);
      } catch {
        // A Room that never completed connect can still reject disconnect.
      }
      peers.clear();

      const settleCleanup = async (action: () => void | Promise<void>): Promise<void> => {
        try {
          await action();
        } catch {
          // Native foreground/audio teardown must not mask the startup error.
        }
      };
      await Promise.all([
        settleCleanup(() => stopRoomForeground()),
        settleCleanup(() => stopLiveKitAudioSession()),
      ]);
    })();
    return cleanupPromise;
  };

  // ─── Initial join ────────────────────────────────────────────────
  try {
    // Configure + start the native audio session BEFORE connecting, so Android
    // sets the in-communication mode and routes capture/playback correctly.
    await startLiveKitAudioSession();
    throwIfInactive();

    // A listener only subscribes to remote tracks: RECORD_AUDIO is not required
    // and requesting it here used to block receive-only audio after a denial.
    // Ask only when the server-issued capability permits publishing.
    const initial = await fetchToken();
    throwIfInactive();
    if (initial.canPublish && !(await requestAudioPermission())) {
      throw new Error(MIC_PERMISSION_DENIED_ERROR);
    }
    throwIfInactive();
    currentRole = initial.canPublish ? 'host' : 'audience';

    bindListener(
      () => room.on(events.ParticipantConnected, handleParticipantConnected),
      () => room.off(events.ParticipantConnected, handleParticipantConnected),
    );
    bindListener(
      () => room.on(events.ParticipantDisconnected, handleParticipantDisconnected),
      () => room.off(events.ParticipantDisconnected, handleParticipantDisconnected),
    );
    bindListener(
      () => room.on(events.ActiveSpeakersChanged, handleActiveSpeakersChanged),
      () => room.off(events.ActiveSpeakersChanged, handleActiveSpeakersChanged),
    );
    bindListener(
      () => room.on(events.Disconnected, handleDisconnected),
      () => room.off(events.Disconnected, handleDisconnected),
    );
    bindListener(
      () => room.on(events.Reconnecting, handleReconnecting),
      () => room.off(events.Reconnecting, handleReconnecting),
    );
    bindListener(
      () => room.on(events.Reconnected, handleReconnected),
      () => room.off(events.Reconnected, handleReconnected),
    );
    bindListener(
      () => socket.on('room:user-joined', handleSocketJoin),
      () => socket.off('room:user-joined', handleSocketJoin),
    );
    bindListener(
      () => socket.on('room:role_changed', handleSocketRoleChange),
      () => socket.off('room:role_changed', handleSocketRoleChange),
    );
    bindListener(
      () => socket.on('room:mute-changed', handleSocketMuteChanged),
      () => socket.off('room:mute-changed', handleSocketMuteChanged),
    );

    await connectLiveKitRoom(room, initial.url, initial.token);
    throwIfInactive();
    scheduleRenewal(initial.expiresAtMs);
    if (initial.canPublish) {
      const isMuted = useCurrentRoomStore.getState().isMuted;
      await setLiveKitMuted(room, isMuted);
      throwIfInactive();
    }

    // Serialize this best-effort start with cleanup: an immediate close must
    // never stop the service before a still-pending start turns it back on.
    try {
      await startRoomForeground();
      throwIfInactive();
    } catch {
      // Audio remains usable when the optional foreground service is absent.
    }
    throwIfInactive();

    // Register existing remote participants.
    for (const [, participant] of room.remoteParticipants) {
      emitJoin(participant.identity);
    }
  } catch (error) {
    await cleanupResources();
    throw error;
  }

  return {
    close: cleanupResources,
    setMuted: async (muted: boolean) => {
      await setLiveKitMuted(room, muted);
    },
    setPeerVolume: (_userId: string, _volume: number) => {
      // LiveKit doesn't expose per-peer playback volume at the SDK level.
      // Individual track volume can be controlled via native audio APIs
      // if needed in the future. No-op for now.
    },
    setRole: async role => {
      // Role changes require a new token — fetch and reconnect
      try {
        const fresh = await fetchToken();
        if (inactive()) return;
        if (fresh.canPublish && !(await requestAudioPermission())) return;
        if (inactive()) return;
        disconnectLiveKitRoom(room);
        await connectLiveKitRoom(room, fresh.url, fresh.token);
        if (inactive()) {
          disconnectLiveKitRoom(room);
          return;
        }
        currentRole = role;
        scheduleRenewal(fresh.expiresAtMs);
        if (fresh.canPublish) {
          const isMuted = useCurrentRoomStore.getState().isMuted;
          await setLiveKitMuted(room, isMuted);
        }
      } catch {
        /* failed to reconnect with new role */
      }
    },
    getPeers: () => peers,
  };
};
