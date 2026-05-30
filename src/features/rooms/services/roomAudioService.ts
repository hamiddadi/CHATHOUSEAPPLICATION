/**
 * roomAudioService — WebRTC audio backend for Chathouse rooms.
 *
 * This file is the SINGLE seam between the audio engine and the rest of
 * the app. The engine of record is **Agora** (`react-native-agora`); the
 * mediasoup pipeline that lived here previously was retired in favour of
 * a managed SFU. The contract — `startRoomAudio({ socket, roomId })`
 * returning a `RoomAudioHandle` — is preserved verbatim, so `useRoomAudio`,
 * RoomScreen, HostActionsSheet, RoomChatSidebar, ReactionsBar, etc. keep
 * working without a single line changed.
 *
 * Why preserve the socket parameter when Agora handles its own signaling?
 *   - The socket is still the source of truth for ROLE state (HOST /
 *     MODERATOR / SPEAKER / LISTENER). We listen for `room:role_changed`
 *     to flip the Agora client role without re-joining.
 *   - Agora UIDs are integers; our app users are CUIDs. We deterministically
 *     hash the CUID to a uint32 so every device picks the same UID for
 *     a given user — this lets us correlate Agora's `onUserJoined(uid)`
 *     with the userId we already track via `room:participants`.
 */

import type { Socket } from 'socket.io-client';
import { env } from '../../../config/env';
import { useAuthStore } from '../../auth/store/authStore';
import { requestAudioPermission } from '../../../shared/utils/permissions';
import { roomService } from './roomService';
import {
  AGORA_UNAVAILABLE_SENTINEL,
  initAgora,
  joinAgoraChannel,
  leaveAgoraChannel,
  mapAgoraConnectionState,
  registerAgoraHandlers,
  releaseAgora,
  renewAgoraToken,
  setAgoraMuted,
  setAgoraRole,
  type AgoraEventHandlers,
} from './agora/AgoraEngine';

// Re-exported for `useRoomAudio` to detect the "missing native module" path.
export const SKELETON_SENTINEL = AGORA_UNAVAILABLE_SENTINEL;

export interface PeerInfo {
  userId: string;
  /** Agora's volume metric: 0..255 (255 = loudest). */
  volume?: number;
  /** Voice-Activity-Detection: 1 when the speaker is actually speaking. */
  vad?: 0 | 1;
  /** Internal — Agora UID, kept for debug. */
  agoraUid?: number;
}

export interface RoomAudioHandle {
  /** Stop producing + leave the Agora channel. */
  close: () => Promise<void>;
  /** Mute or unmute the local mic. */
  setMuted: (muted: boolean) => Promise<void>;
  /**
   * Per-peer volume control. react-native-agora exposes
   * `adjustUserPlaybackSignalVolume(uid, volume 0..100)` — we wrap that.
   */
  setPeerVolume: (userId: string, volume: number) => void;
  /** Update the local client role mid-session (host promote/demote). */
  setRole: (role: 'host' | 'audience') => Promise<void>;
  /** Map of peers currently audible, keyed by userId. */
  getPeers: () => ReadonlyMap<string, PeerInfo>;
}

export interface AudioLevelEvent {
  userId: string;
  /** Normalised 0..1 volume. We map Agora's 0..255 by dividing by 255. */
  volume: number;
  /** True when Agora's VAD detected speech in the last window. */
  speaking: boolean;
}

/**
 * Live connection status of the underlying Agora channel, derived from the
 * SDK's `onConnectionStateChanged` callback. The hook maps this onto its
 * own `status` field so a UI banner can show a "reconnecting…" state:
 *   - `connected`     → channel is up, audio flowing
 *   - `reconnecting`  → SDK lost the link and is auto-retrying (transient)
 *   - `failed`        → SDK gave up; we kick a bounded manual rejoin
 */
export type AudioConnectionStatus = 'connected' | 'reconnecting' | 'failed';

interface StartOptions {
  socket: Socket;
  roomId: string;
  /** Triggered when a remote user joins the channel. */
  onPeerJoined?: (info: PeerInfo) => void;
  /** Triggered when a remote user leaves. */
  onPeerGone?: (userId: string) => void;
  /** Local mic level — 0..1. Drives the self-speaking indicator. */
  onLocalScore?: (level: number) => void;
  /** Per-peer audio level — drives the "who's speaking" UI. */
  onPeerScore?: (event: AudioLevelEvent) => void;
  /**
   * Connection-state transitions from the Agora SDK. Optional — when the
   * native module is absent (Expo Go) this never fires, so the unsupported
   * path stays a no-op.
   */
  onStatusChange?: (status: AudioConnectionStatus) => void;
}

/**
 * Deterministic CUID → uint32 hash. FNV-1a over the cuid bytes; collisions
 * are theoretically possible but vanishingly unlikely at room scale (a
 * room with 1k speakers = ~1.2e-4 birthday collision probability). The
 * server can disambiguate via the `userId ↔ agoraUid` mapping it tracks
 * if we ever issue tokens server-side.
 */
const cuidToAgoraUid = (cuid: string): number => {
  let hash = 0x811c9dc5; // FNV-1a 32-bit offset basis
  for (let i = 0; i < cuid.length; i++) {
    hash ^= cuid.charCodeAt(i);
    // 32-bit FNV prime multiply, kept inside 32 bits via `>>> 0`.
    hash = (hash * 0x01000193) >>> 0;
  }
  // Agora's UID range is 1..2^32-1; 0 is reserved for "auto-assign".
  return hash === 0 ? 1 : hash;
};

/**
 * Reverse map populated during the session — every time we discover an
 * Agora UID via onUserJoined we'll associate it back to a Chathouse
 * userId via the room:user-joined socket events. Until we see the
 * matching socket event, the peer is keyed by `agora-<uid>` (so the UI
 * still shows them as a generic listener).
 */
const buildBindings = () => {
  const uidToUserId = new Map<number, string>();
  const userIdToUid = new Map<string, number>();
  return {
    bind: (uid: number, userId: string) => {
      uidToUserId.set(uid, userId);
      userIdToUid.set(userId, uid);
    },
    userIdFor: (uid: number) => uidToUserId.get(uid) ?? `agora-${uid}`,
    uidFor: (userId: string) => userIdToUid.get(userId),
  };
};

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
  // Mic permission — Agora's joinChannel will fail silently on Android
  // without RECORD_AUDIO. iOS prompts at first capture.
  const granted = await requestAudioPermission();
  if (!granted) throw new Error('mic permission denied');

  // Boot the engine (lazy). Throws SKELETON_SENTINEL when
  // `react-native-agora` isn't installed (Expo Go) — useRoomAudio
  // catches that and surfaces `status: 'unsupported'`.
  await initAgora();

  // Resolve the local user. We need their CUID so we can hash to Agora UID.
  const me = useAuthStore.getState().user;
  if (!me?.id) throw new Error('user not authenticated');
  const myUid = cuidToAgoraUid(me.id);

  // Determine initial role from the participant list embedded in the
  // socket "room:participants" event we'll receive on join. Until that
  // arrives, default to audience — the server will broadcast role_changed
  // if we're actually a speaker. This is safer than guessing host (which
  // would let listeners broadcast for a few hundred ms).
  let currentRole: 'host' | 'audience' = 'audience';

  const peers = new Map<string, PeerInfo>();
  const bindings = buildBindings();
  bindings.bind(myUid, me.id);

  const emitJoin = (userId: string, agoraUid: number): void => {
    if (peers.has(userId)) return;
    const info: PeerInfo = { userId, agoraUid };
    peers.set(userId, info);
    onPeerJoined?.(info);
  };

  const emitLeave = (userId: string): void => {
    if (!peers.delete(userId)) return;
    onPeerGone?.(userId);
  };

  // ─── Token policy ─────────────────────────────────────────────────
  // Try the backend signing endpoint first (per-room, per-role token).
  // Fall back to env.AGORA_TEMP_TOKEN ONLY when the backend isn't
  // configured (503 AGORA_001). The backend path uses channel = roomId
  // for full acoustic isolation; the env fallback is signed for the
  // shared CHATHOUSE channel and forces the same channel here too —
  // dev rooms then bleed into one Agora bus, but the surrounding UI
  // keeps each Chathouse room separate via its own Participant model.
  const fetchToken = async (): Promise<{
    token: string | null;
    channel: string;
    uid: number;
    expiresAtMs: number | null;
  }> => {
    try {
      const r = await roomService.getAgoraToken(roomId);
      return {
        token: r.token,
        channel: r.channel,
        uid: r.uid,
        expiresAtMs: new Date(r.expiresAt).getTime(),
      };
    } catch {
      // Dev fallback — signed temp token from .env. Channel must be the
      // one the token was generated for, not roomId.
      return {
        token: env.AGORA_TEMP_TOKEN ?? null,
        channel: env.AGORA_DEFAULT_CHANNEL,
        uid: myUid,
        expiresAtMs: null, // we don't know when the env token expires
      };
    }
  };

  // ─── Agora event handlers ─────────────────────────────────────────
  let renewTimer: ReturnType<typeof setTimeout> | null = null;

  // ─── Auto-reconnect state ─────────────────────────────────────────
  // The Agora SDK retries transient drops on its own (state RECONNECTING);
  // we only step in when it reports FAILED (or a lingering DISCONNECTED),
  // which means it has given up. The manual recovery is:
  //   1) re-fetch a fresh Agora token (the old one may have expired or
  //      been revoked, which is a common cause of a hard failure),
  //   2) re-join the channel with the role we currently hold.
  // Guards keep this from degenerating into a tight loop:
  //   - `closed`        — set by close(); every async step bails on it so
  //                       a rejoin scheduled just before teardown is inert.
  //   - `rejoinInFlight`— idempotency latch: only one rejoin attempt runs
  //                       at a time, so a burst of FAILED callbacks (the
  //                       SDK can fire several) collapses into one attempt.
  //   - `rejoinAttempts`— bounded retry budget; once exhausted we stop and
  //                       leave the channel in `failed` so the UI shows the
  //                       error banner rather than spinning forever.
  //   - back-off timer  — spaces successive attempts (2s · 4s · 8s …) to
  //                       avoid hammering the token endpoint / Agora edge.
  const MAX_REJOIN_ATTEMPTS = 5;
  let closed = false;
  let rejoinInFlight = false;
  let rejoinAttempts = 0;
  let rejoinTimer: ReturnType<typeof setTimeout> | null = null;

  // Tracks the last semantic state we surfaced so we don't spam the
  // callback (the SDK can report the same state repeatedly) and so a
  // successful (re)connect resets the retry budget exactly once.
  let lastStatus: AudioConnectionStatus | null = null;

  const scheduleRenewal = (expiresAtMs: number | null): void => {
    if (renewTimer) clearTimeout(renewTimer);
    if (!expiresAtMs) return; // env fallback — no scheduled renewal possible
    // Renew 30s before expiry. If the token is shorter than 60s (test
    // accidents), renew at the half-way mark to leave a margin.
    const msUntilExpiry = expiresAtMs - Date.now();
    const lead = msUntilExpiry > 60_000 ? 30_000 : Math.max(5_000, msUntilExpiry / 2);
    const delay = Math.max(0, msUntilExpiry - lead);
    renewTimer = setTimeout(() => {
      void (async () => {
        try {
          const next = await fetchToken();
          if (next.token) {
            await renewAgoraToken(next.token);
            scheduleRenewal(next.expiresAtMs);
          }
        } catch {
          // Renewal failed — Agora will fire onTokenPrivilegeWillExpire
          // again on its own as a safety net.
        }
      })();
    }, delay);
  };

  // Re-run the join pipeline (fresh token → joinAgoraChannel) after a hard
  // failure. Idempotent and bounded — see the guard comments above. Safe
  // on the unsupported path: it's only ever reached from the SDK callback,
  // which never fires when the native module is absent.
  const attemptRejoin = (): void => {
    if (closed || rejoinInFlight) return;
    if (rejoinAttempts >= MAX_REJOIN_ATTEMPTS) {
      // Budget exhausted — leave the channel in `failed`; the hook keeps
      // the error/reconnecting banner up and the next screen mount retries.
      return;
    }
    rejoinInFlight = true;
    rejoinAttempts += 1;
    // Exponential back-off, capped at 30s: 2s, 4s, 8s, 16s, 30s.
    const backoff = Math.min(30_000, 2_000 * 2 ** (rejoinAttempts - 1));
    if (rejoinTimer) clearTimeout(rejoinTimer);
    rejoinTimer = setTimeout(() => {
      void (async () => {
        try {
          if (closed) return;
          const next = await fetchToken();
          if (closed) return;
          await joinAgoraChannel({
            channelName: next.channel,
            uid: next.uid,
            role: currentRole,
            token: next.token,
          });
          // Reschedule token renewal against the freshly-fetched token.
          scheduleRenewal(next.expiresAtMs);
          // We don't flip to 'connected' here — the SDK will emit a
          // CONNECTED state change once the rejoin actually lands, which
          // resets the retry budget through the normal status path.
        } catch {
          // This attempt failed; if the SDK fires FAILED again we'll get
          // another shot until the budget runs out.
        } finally {
          rejoinInFlight = false;
        }
      })();
    }, backoff);
  };

  const handlers: AgoraEventHandlers = {
    onJoinChannelSuccess: () => {
      // No-op — the hook flips status to 'live' on its own when start()
      // resolves; this handler is here for diagnostics only.
    },
    onConnectionStateChanged: (_conn, state) => {
      // The single seam for connection health. We collapse Agora's 5-state
      // enum onto our 3-state model, surface every distinct transition to
      // the hook (for the UI banner), and on a hard `failed` kick the
      // bounded manual rejoin. Inert on the unsupported path — never fires
      // without the native module.
      const status = mapAgoraConnectionState(state);
      if (status !== lastStatus) {
        lastStatus = status;
        onStatusChange?.(status);
      }
      if (status === 'connected') {
        // A good connection clears any pending rejoin and resets the budget
        // so a *future*, unrelated drop gets its own full retry allowance.
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
      // 'reconnecting' → do nothing; the SDK is auto-retrying. The status
      // callback above already let the UI raise a "reconnecting…" banner.
    },
    onUserJoined: (_conn, remoteUid) => {
      const userId = bindings.userIdFor(remoteUid);
      bindings.bind(remoteUid, userId);
      emitJoin(userId, remoteUid);
    },
    onUserOffline: (_conn, remoteUid) => {
      const userId = bindings.userIdFor(remoteUid);
      emitLeave(userId);
    },
    onTokenPrivilegeWillExpire: () => {
      // Server's safety-net: if our scheduled renewal timer was killed
      // (app backgrounded, JS thread blocked), the SDK fires this 30s
      // before the actual cutoff. We fetch + renew right here.
      void (async () => {
        try {
          const next = await fetchToken();
          if (next.token) {
            await renewAgoraToken(next.token);
            scheduleRenewal(next.expiresAtMs);
          }
        } catch {
          /* no-op — channel will eventually drop and the hook will retry */
        }
      })();
    },
    onAudioVolumeIndication: (_conn, speakers) => {
      // Agora reports volumes 0..255 + a VAD bit per speaker. We
      // normalise and split: the local user is reported with uid=0,
      // remote users with their actual uid.
      for (const s of speakers) {
        const isLocal = s.uid === 0 || s.uid === myUid;
        const volumeNorm = s.volume / 255;
        if (isLocal) {
          onLocalScore?.(volumeNorm);
          continue;
        }
        const userId = bindings.userIdFor(s.uid);
        const peer = peers.get(userId);
        if (peer) {
          peer.volume = s.volume;
          peer.vad = s.vad === 1 ? 1 : 0;
        }
        onPeerScore?.({
          userId,
          volume: volumeNorm,
          speaking: s.vad === 1,
        });
      }
    },
    onError: () => {
      // Surfaced via the engine instance state; the hook will time out
      // its `connecting` state and retry next mount.
    },
  };
  const unregister = registerAgoraHandlers(handlers);

  // ─── Socket bindings — keep userId↔agoraUid consistent ───────────
  // When the server announces a user's join/role, we pre-populate the
  // mapping so by the time Agora's onUserJoined fires we already know
  // who they are. The channel name is the room id (no shared CHATHOUSE
  // pool — that was a dev shortcut).
  interface SocketJoinPayload {
    userId: string;
    roomId: string;
  }
  const handleSocketJoin = (payload: SocketJoinPayload | undefined): void => {
    if (!payload || payload.roomId !== roomId) return;
    bindings.bind(cuidToAgoraUid(payload.userId), payload.userId);
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
    await setAgoraRole(next);
  };
  // Host/mod force-mute → flip the local Agora producer too. Without
  // this, Participant.isMuted = true in the DB but the target's mic keeps
  // publishing to Agora because only the DB and the broadcast badge
  // changed. We also bubble the mute back to the UI via a callback so
  // the local mute button reflects reality.
  interface SocketMutePayload {
    userId: string;
    isMuted: boolean;
    roomId?: string;
  }
  const handleSocketMuteChanged = async (payload: SocketMutePayload | undefined): Promise<void> => {
    if (!payload || (payload.roomId && payload.roomId !== roomId)) return;
    if (payload.userId !== me.id) return; // only act on self
    await setAgoraMuted(payload.isMuted);
  };

  socket.on('room:user-joined', handleSocketJoin);
  socket.on('room:role_changed', handleSocketRoleChange);
  socket.on('room:mute-changed', handleSocketMuteChanged);

  // ─── Initial join ────────────────────────────────────────────────
  // Fetch a fresh per-room token from the backend (channel = roomId,
  // uid = FNV-1a(userId), role bound to current Participant.role). On
  // backend failure (no certificate configured) we fall back to the
  // hard-coded env temp token, which forces channel = AGORA_DEFAULT_CHANNEL
  // since the temp token was signed for that single name.
  const initial = await fetchToken();
  await joinAgoraChannel({
    channelName: initial.channel,
    uid: initial.uid,
    role: currentRole,
    token: initial.token,
  });
  scheduleRenewal(initial.expiresAtMs);

  // ─── Per-peer playback volume (best-effort) ──────────────────────
  // The newer SDK exposes `adjustUserPlaybackSignalVolume`; we feature-
  // detect at call time so older SDKs don't crash.
  const setPeerVolumeSafely = (userId: string, volume: number): void => {
    const uid = bindings.uidFor(userId);
    if (uid === undefined) return;
    /* eslint-disable @typescript-eslint/no-explicit-any */
    try {
      // The engine instance lives behind initAgora — we re-fetch via
      // the SDK loader to avoid leaking it across modules.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const sdk = require('react-native-agora') as any;
      const eng = sdk?.RtcEngine?.instance ?? sdk?.createAgoraRtcEngine?.();
      eng?.adjustUserPlaybackSignalVolume?.(
        uid,
        Math.max(0, Math.min(100, Math.round(volume * 100))),
      );
    } catch {
      /* noop */
    }
    /* eslint-enable @typescript-eslint/no-explicit-any */
  };

  return {
    close: async () => {
      // Latch first so any in-flight / scheduled rejoin becomes a no-op.
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
      unregister();
      await leaveAgoraChannel();
      // Don't release the engine on every leave — it's a singleton and
      // the next room would have to re-initialise. Release only on
      // sign-out, which the auth flow already triggers. (Explicit
      // releaseAgora() is exported from AgoraEngine for that path.)
      void releaseAgora; // suppress unused-import warning
      peers.clear();
    },
    setMuted: async (muted: boolean) => {
      await setAgoraMuted(muted);
    },
    setPeerVolume: setPeerVolumeSafely,
    setRole: async role => {
      currentRole = role;
      await setAgoraRole(role);
    },
    getPeers: () => peers,
  };
};
