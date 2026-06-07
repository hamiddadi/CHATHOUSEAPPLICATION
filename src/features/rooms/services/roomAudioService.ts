/**
 * roomAudioService — WebRTC audio backend for Chathouse rooms.
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
  type LiveKitRoom,
  type LiveKitParticipant,
} from './livekit/LiveKitEngine';

// Re-exported for `useRoomAudio` to detect the "missing native module" path.
export const SKELETON_SENTINEL = LIVEKIT_UNAVAILABLE_SENTINEL;

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
}: StartOptions): Promise<RoomAudioHandle> => {
  // Mic permission — LiveKit's connect will fail without RECORD_AUDIO
  // on Android. iOS prompts at first capture.
  const granted = await requestAudioPermission();
  if (!granted) throw new Error('mic permission denied');

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

  const scheduleRenewal = (expiresAtMs: number | null): void => {
    if (renewTimer) clearTimeout(renewTimer);
    if (!expiresAtMs) return;
    const msUntilExpiry = expiresAtMs - Date.now();
    const lead = msUntilExpiry > 60_000 ? 30_000 : Math.max(5_000, msUntilExpiry / 2);
    const delay = Math.max(0, msUntilExpiry - lead);
    renewTimer = setTimeout(() => {
      void (async () => {
        try {
          if (closed) return;
          // For LiveKit, token renewal requires a reconnect with the
          // new token. We disconnect and reconnect.
          const next = await fetchToken();
          if (closed) return;
          disconnectLiveKitRoom(room);
          await connectLiveKitRoom(room, next.url, next.token);
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
    if (closed || rejoinInFlight) return;
    if (rejoinAttempts >= MAX_REJOIN_ATTEMPTS) return;
    rejoinInFlight = true;
    rejoinAttempts += 1;
    const backoff = Math.min(30_000, 2_000 * 2 ** (rejoinAttempts - 1));
    if (rejoinTimer) clearTimeout(rejoinTimer);
    rejoinTimer = setTimeout(() => {
      void (async () => {
        try {
          if (closed) return;
          const next = await fetchToken();
          if (closed) return;
          await connectLiveKitRoom(room, next.url, next.token);
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
        onLocalScore?.(volumeNorm);
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

    // Reset the SELF indicator when we drop out of the active-speaker set —
    // otherwise the local "speaking" ring stays lit forever after we go quiet,
    // because the local branch above only ever pushes a non-zero level (#8).
    if (!speakerIdentities.has(me.id)) {
      onLocalScore?.(0);
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

  // Register LiveKit event handlers
  room.on(events.ParticipantConnected, handleParticipantConnected);
  room.on(events.ParticipantDisconnected, handleParticipantDisconnected);
  room.on(events.ActiveSpeakersChanged, handleActiveSpeakersChanged);
  room.on(events.Disconnected, handleDisconnected);
  room.on(events.Reconnecting, handleReconnecting);
  room.on(events.Reconnected, handleReconnected);

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
    currentRole = next;
    // Role change requires a new token with updated canPublish.
    // Reconnect with a fresh token.
    try {
      const fresh = await fetchToken();
      if (closed) return;
      disconnectLiveKitRoom(room);
      await connectLiveKitRoom(room, fresh.url, fresh.token);
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
    await setLiveKitMuted(room, payload.isMuted);
  };

  socket.on('room:user-joined', handleSocketJoin);
  socket.on('room:role_changed', handleSocketRoleChange);
  socket.on('room:mute-changed', handleSocketMuteChanged);

  // ─── Initial join ────────────────────────────────────────────────
  // Fetch a fresh per-room token from the backend (room = roomId,
  // identity = userId, canPublish based on current Participant.role).
  const initial = await fetchToken();
  await connectLiveKitRoom(room, initial.url, initial.token);
  scheduleRenewal(initial.expiresAtMs);
  if (initial.canPublish) {
    const isMuted = useCurrentRoomStore.getState().isMuted;
    await setLiveKitMuted(room, isMuted);
  }

  // Register existing remote participants
  for (const [, participant] of room.remoteParticipants) {
    emitJoin(participant.identity);
  }

  return {
    close: async () => {
      closed = true;
      if (renewTimer) {
        clearTimeout(renewTimer);
        renewTimer = null;
      }
      if (rejoinTimer) {
        clearTimeout(rejoinTimer);
        rejoinTimer = null;
      }
      socket.off('room:user-joined', handleSocketJoin);
      socket.off('room:role_changed', handleSocketRoleChange);
      socket.off('room:mute-changed', handleSocketMuteChanged);
      // Unregister LiveKit event handlers
      room.off(events.ParticipantConnected, handleParticipantConnected);
      room.off(events.ParticipantDisconnected, handleParticipantDisconnected);
      room.off(events.ActiveSpeakersChanged, handleActiveSpeakersChanged);
      room.off(events.Disconnected, handleDisconnected);
      room.off(events.Reconnecting, handleReconnecting);
      room.off(events.Reconnected, handleReconnected);
      disconnectLiveKitRoom(room);
      peers.clear();
    },
    setMuted: async (muted: boolean) => {
      await setLiveKitMuted(room, muted);
    },
    setPeerVolume: (_userId: string, _volume: number) => {
      // LiveKit doesn't expose per-peer playback volume at the SDK level.
      // Individual track volume can be controlled via native audio APIs
      // if needed in the future. No-op for now.
    },
    setRole: async role => {
      currentRole = role;
      // Role changes require a new token — fetch and reconnect
      try {
        const fresh = await fetchToken();
        if (closed) return;
        disconnectLiveKitRoom(room);
        await connectLiveKitRoom(room, fresh.url, fresh.token);
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
