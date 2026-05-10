import { RtcRole, RtcTokenBuilder } from 'agora-token';
import { env } from '../../config/env';
import { AppError } from '../../middlewares/error.middleware';

/**
 * Agora token signer. Issues short-lived per-room, per-user tokens.
 *
 * Architecture:
 *  - Channel name = roomId (cuids are < 64 ASCII chars, well within Agora's
 *    channel naming limits). Each Chathouse room maps 1-to-1 to an Agora
 *    channel for full acoustic isolation.
 *  - UID = FNV-1a 32-bit hash of the user's CUID. We MUST use the same
 *    hash on both sides — the client computes the UID locally to call
 *    `joinChannel`, and the token is signed for that exact UID.
 *  - Role = HOST / MODERATOR / SPEAKER → PUBLISHER (broadcaster), allowed
 *    to push audio. LISTENER → SUBSCRIBER (audience), receive-only.
 *
 * SECURITY: This file is the ONLY place that touches AGORA_PRIMARY_CERTIFICATE.
 * The certificate must never appear in client logs, error responses, or
 * audit trail metadata.
 */

export type AgoraParticipantRole = 'HOST' | 'MODERATOR' | 'SPEAKER' | 'LISTENER';

/**
 * FNV-1a 32-bit hash. MUST match the implementation in
 * `src/features/rooms/services/roomAudioService.ts → cuidToAgoraUid`. Any
 * drift between the two and Agora rejects the token because the signed
 * UID won't match the one the client passes to `joinChannel`.
 */
export const cuidToAgoraUid = (cuid: string): number => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < cuid.length; i++) {
    hash ^= cuid.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash === 0 ? 1 : hash;
};

const isAgoraConfigured = (): boolean => Boolean(env.AGORA_APP_ID && env.AGORA_PRIMARY_CERTIFICATE);

export const agoraService = {
  isConfigured: isAgoraConfigured,

  /**
   * Issue a token good for `env.AGORA_TOKEN_TTL_SECONDS`. Returns the
   * triplet the client needs: token + uid + channel + the absolute
   * expiry (so the client can schedule its own pre-emptive renewal).
   */
  issueRoomToken(input: { roomId: string; userId: string; role: AgoraParticipantRole }): {
    token: string;
    appId: string;
    channel: string;
    uid: number;
    role: 'publisher' | 'subscriber';
    expiresAt: string;
    expiresInSec: number;
  } {
    if (!isAgoraConfigured()) {
      // 503 surfaces nicely client-side as "service unavailable" — better
      // than a generic 500 which would be hidden by axios's error path.
      throw new AppError('AGORA_001');
    }
    const appId = env.AGORA_APP_ID as string;
    const cert = env.AGORA_PRIMARY_CERTIFICATE as string;

    const channel = input.roomId;
    const uid = cuidToAgoraUid(input.userId);
    const ttl = env.AGORA_TOKEN_TTL_SECONDS;
    const nowSec = Math.floor(Date.now() / 1000);
    const privilegeExpire = nowSec + ttl;

    // PUBLISHER vs SUBSCRIBER controls whether the user can push audio.
    // Listeners get SUBSCRIBER; everything else gets PUBLISHER. The
    // client also calls `setClientRole(broadcaster|audience)` — the two
    // must agree, otherwise Agora will reject the publish attempt.
    const isPublisher =
      input.role === 'HOST' || input.role === 'MODERATOR' || input.role === 'SPEAKER';
    const rtcRole = isPublisher ? RtcRole.PUBLISHER : RtcRole.SUBSCRIBER;

    const token = RtcTokenBuilder.buildTokenWithUid(
      appId,
      cert,
      channel,
      uid,
      rtcRole,
      privilegeExpire,
      privilegeExpire,
    );

    return {
      token,
      appId,
      channel,
      uid,
      role: isPublisher ? 'publisher' : 'subscriber',
      expiresAt: new Date(privilegeExpire * 1000).toISOString(),
      expiresInSec: ttl,
    };
  },
};
