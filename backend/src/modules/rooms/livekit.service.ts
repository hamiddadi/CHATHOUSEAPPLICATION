import { AccessToken, RoomServiceClient } from 'livekit-server-sdk';
import { env } from '../../config/env';
import { logger } from '../../config/logger';
import { AppError } from '../../middlewares/error.middleware';

/**
 * LiveKit token signer. Issues short-lived per-room, per-user access tokens.
 *
 * Architecture:
 *  - Room name = roomId (cuids are < 64 ASCII chars, well within LiveKit's
 *    room naming limits). Each Chathouse room maps 1-to-1 to a LiveKit room
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

const isLivekitConfigured = (): boolean =>
  Boolean(env.LIVEKIT_API_KEY && env.LIVEKIT_API_SECRET && env.LIVEKIT_URL);

// EgressClient/RoomServiceClient want the HTTP(S) host; LIVEKIT_URL is ws(s)://.
const httpHost = (wsUrl: string): string => wsUrl.replace(/^ws/i, 'http');

// Lazily-built admin client for server-side room moderation (kick / close).
// Reused across calls; null until LiveKit is configured.
let roomServiceRef: RoomServiceClient | null = null;
const roomServiceClient = (): RoomServiceClient | null => {
  if (!isLivekitConfigured()) return null;
  if (!roomServiceRef) {
    roomServiceRef = new RoomServiceClient(
      httpHost(env.LIVEKIT_URL as string),
      env.LIVEKIT_API_KEY as string,
      env.LIVEKIT_API_SECRET as string,
    );
  }
  return roomServiceRef;
};

export const livekitService = {
  isConfigured: isLivekitConfigured,

  /**
   * Issue a token good for `env.LIVEKIT_TOKEN_TTL_SECONDS`. Returns the
   * triplet the client needs: token + url + room + identity + the absolute
   * expiry (so the client can schedule its own pre-emptive renewal).
   */
  async issueRoomToken(input: {
    roomId: string;
    userId: string;
    role: LivekitParticipantRole;
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
    const ttl = env.LIVEKIT_TOKEN_TTL_SECONDS;

    // canPublish controls whether the user can push audio.
    // Listeners get canPublish=false; everything else gets canPublish=true.
    const canPublish =
      input.role === 'HOST' || input.role === 'MODERATOR' || input.role === 'SPEAKER';

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
   * audio until the token expires. Best-effort: no-op when LiveKit isn't
   * configured, and swallows "participant not found" (they may never have
   * connected to the audio bus). identity === userId by our token convention.
   */
  async removeParticipant(roomId: string, userId: string): Promise<void> {
    const client = roomServiceClient();
    if (!client) return;
    try {
      await client.removeParticipant(roomId, userId);
    } catch (err) {
      logger.warn('livekit removeParticipant failed', {
        roomId,
        userId,
        err: err instanceof Error ? err.message : err,
      });
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
      logger.warn('livekit deleteRoom failed', {
        roomId,
        err: err instanceof Error ? err.message : err,
      });
    }
  },
};
