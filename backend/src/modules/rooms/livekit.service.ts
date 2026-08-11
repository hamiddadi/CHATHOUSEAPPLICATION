import { AccessToken, RoomServiceClient } from 'livekit-server-sdk';
import { env, LIVEKIT_TOKEN_MAX_TTL_SECONDS } from '../../config/env';
import { AppError } from '../../middlewares/error.middleware';
import { hasCurrentLegalAcceptance } from '../auth/legal-acceptance';

/**
 * LiveKit token signer. Issues short-lived per-room, per-user access tokens.
 *
 * Architecture:
 *  - Room name = roomId (cuids are < 64 ASCII chars, well within LiveKit's
 *    room naming limits). Each ChatHouse room maps 1-to-1 to a LiveKit room
 *    for full acoustic isolation.
 *  - Identity = userId (string). LiveKit uses string identities natively,
 *    so we no longer need the FNV-1a hash that Agora required for uint32 UIDs.
 *  - Role = HOST / MODERATOR / SPEAKER → canPublish: true (can push audio).
 *    LISTENER → canPublish: false, canSubscribe: true (receive-only).
 *
 * SECURITY: This file is the ONLY place that touches LIVEKIT_API_SECRET.
 * The secret must never appear in client logs, error responses, or audit
 * trail metadata.
 */

export type LivekitParticipantRole = 'HOST' | 'MODERATOR' | 'SPEAKER' | 'LISTENER';
// Must stay below OUTBOX_HANDLER_TIMEOUT_MS (20s): no timed-out provider call
// may complete later and overwrite a newer mute/revocation decision.
export const LIVEKIT_ADMIN_REQUEST_TIMEOUT_SECONDS = 15;

const isLivekitConfigured = (): boolean =>
  Boolean(env.LIVEKIT_API_KEY && env.LIVEKIT_API_SECRET && env.LIVEKIT_URL);

// RoomServiceClient wants an HTTP(S) host. Prefer the server-to-server address
// when the API and LiveKit run in separate containers; otherwise fall back to
// the public ws(s) endpoint converted to http(s).
const httpHost = (wsUrl: string): string => wsUrl.replace(/^ws/i, 'http');

const errorMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err));

const isAlreadyAbsent = (err: unknown): boolean => {
  if (!err || typeof err !== 'object') return false;

  // Only the structured Twirp/gRPC provider code proves idempotent absence.
  // A reverse proxy or wrong endpoint can return a generic 404 HTML response;
  // acknowledging that would strand a participant on the real LiveKit server.
  const candidate = err as { code?: unknown };
  const code = typeof candidate.code === 'string' ? candidate.code.toLowerCase() : candidate.code;
  return code === 'not_found' || code === 'notfound' || code === 5;
};

const isAlreadyPresent = (err: unknown): boolean => {
  const message = errorMessage(err).toLowerCase();
  if (
    message.includes('already exists') ||
    message.includes('already_exists') ||
    message.includes('already-exists')
  ) {
    return true;
  }
  if (!err || typeof err !== 'object') return false;

  const candidate = err as { code?: unknown; status?: unknown };
  const code = typeof candidate.code === 'string' ? candidate.code.toLowerCase() : '';
  return code === 'already_exists' || code === 'alreadyexists' || candidate.status === 409;
};

// Lazily-built admin client for server-side room moderation (kick / close).
// Reused across calls; null until LiveKit is configured.
let roomServiceRef: RoomServiceClient | null = null;
const roomServiceClient = (): RoomServiceClient | null => {
  if (!isLivekitConfigured()) return null;
  if (!roomServiceRef) {
    roomServiceRef = new RoomServiceClient(
      httpHost(env.LIVEKIT_INTERNAL_URL ?? (env.LIVEKIT_URL as string)),
      env.LIVEKIT_API_KEY as string,
      env.LIVEKIT_API_SECRET as string,
      { requestTimeout: LIVEKIT_ADMIN_REQUEST_TIMEOUT_SECONDS },
    );
  }
  return roomServiceRef;
};

const ensureRoomExists = async (room: string): Promise<void> => {
  const client = roomServiceClient();
  if (!client) throw new AppError('LIVEKIT_001');

  try {
    await client.createRoom({ name: room });
  } catch (err) {
    // Concurrent token requests can race to create the same room. LiveKit's
    // already-exists response is the successful/idempotent outcome here.
    if (isAlreadyPresent(err)) return;
    throw err;
  }
};

export const livekitService = {
  isConfigured: isLivekitConfigured,

  /** Provision the provider room before entering a short database lock. */
  async ensureRoom(roomId: string): Promise<void> {
    await ensureRoomExists(roomId);
  },

  /**
   * Issue a token good for `env.LIVEKIT_TOKEN_TTL_SECONDS`. Returns the
   * triplet the client needs: token + url + room + identity + the absolute
   * expiry (so the client can schedule its own pre-emptive renewal).
   */
  async issueRoomToken(input: {
    roomId: string;
    userId: string;
    role: LivekitParticipantRole;
    /** Authoritative DB-derived override used by the locked token path. */
    canPublish?: boolean;
    /** The caller already provisioned the room before acquiring DB locks. */
    roomReady?: boolean;
  }): Promise<{
    token: string;
    url: string;
    room: string;
    identity: string;
    canPublish: boolean;
    expiresAt: string;
    expiresInSec: number;
  }> {
    if (!isLivekitConfigured()) {
      // 503 surfaces nicely client-side as "service unavailable" — better
      // than a generic 500 which would be hidden by axios's error path.
      throw new AppError('LIVEKIT_001');
    }
    const apiKey = env.LIVEKIT_API_KEY as string;
    const apiSecret = env.LIVEKIT_API_SECRET as string;
    const url = env.LIVEKIT_URL as string;

    const room = input.roomId;
    const identity = input.userId;
    // Defense in depth in case Env is ever populated outside the validated
    // schema (tests, migrations, or a future config adapter).
    const ttl = Math.min(env.LIVEKIT_TOKEN_TTL_SECONDS, LIVEKIT_TOKEN_MAX_TTL_SECONDS);

    // canPublish controls whether the user can push audio.
    // Listeners get canPublish=false; everything else gets canPublish=true.
    const roleCanPublish =
      input.role === 'HOST' || input.role === 'MODERATOR' || input.role === 'SPEAKER';
    // Existing accounts that have not accepted the current Terms may still
    // listen, but their signed provider capability is receive-only. This
    // closes the native LiveKit publishing path in addition to HTTP/socket UGC.
    const canPublish =
      input.canPublish ?? (roleCanPublish && (await hasCurrentLegalAcceptance(input.userId)));

    // Self-hosted LiveKit runs with room.auto_create=false. Ensure the
    // application room exists before minting any usable join capability.
    // A transport/server failure therefore fails closed: no JWT is signed.
    if (!input.roomReady) await ensureRoomExists(room);

    const at = new AccessToken(apiKey, apiSecret, {
      identity,
      ttl: `${ttl}s`,
    });

    at.addGrant({
      room,
      roomJoin: true,
      canPublish,
      canSubscribe: true,
      // canPublishData enables data channel (chat, reactions are over
      // socket.io so we don't need it, but it's harmless to leave on).
      canPublishData: false,
    });

    const token = await at.toJwt();
    const nowSec = Math.floor(Date.now() / 1000);
    const expiresAtSec = nowSec + ttl;

    return {
      token,
      url,
      room,
      identity,
      canPublish,
      expiresAt: new Date(expiresAtSec * 1000).toISOString(),
      expiresInSec: ttl,
    };
  },

  /**
   * Force-disconnect a participant from the LiveKit room (server-side kick).
   * Without this, a kicked client's still-valid token lets it keep streaming
   * audio until the token expires. No-op when LiveKit isn't configured, and
   * treats "participant not found" as idempotent success (they may never have
   * connected to the audio bus). Every other provider error propagates so the
   * transactional outbox can retry. identity === userId by our token convention.
   */
  async removeParticipant(roomId: string, userId: string): Promise<void> {
    const client = roomServiceClient();
    if (!client) return;
    try {
      await client.removeParticipant(roomId, userId);
    } catch (err) {
      if (isAlreadyAbsent(err)) return;
      throw err;
    }
  },

  /**
   * Converge an already-connected participant to the current application
   * publishing policy. Repeated calls are idempotent; a disconnected identity
   * is also success, while provider outages propagate to the durable outbox.
   */
  async setParticipantCanPublish(
    roomId: string,
    userId: string,
    canPublish: boolean,
  ): Promise<void> {
    const client = roomServiceClient();
    if (!client) return;
    try {
      await client.updateParticipant(roomId, userId, {
        permission: {
          canPublish,
          canSubscribe: true,
          canPublishData: false,
        },
      });
    } catch (err) {
      if (isAlreadyAbsent(err)) return;
      throw err;
    }
  },

  /**
   * Delete the LiveKit room server-side (force-disconnects everyone). Called
   * when a host ends the room so a reused roomId can't inherit stale audio
   * state. Best-effort; no-op when LiveKit isn't configured.
   */
  async deleteRoom(roomId: string): Promise<void> {
    const client = roomServiceClient();
    if (!client) return;
    try {
      await client.deleteRoom(roomId);
    } catch (err) {
      if (isAlreadyAbsent(err)) return;
      throw err;
    }
  },
};
