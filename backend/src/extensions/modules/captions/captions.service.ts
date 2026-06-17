import { redis } from '../../../config/redis';
import { prisma } from '../../../config/database';
import { logger } from '../../../config/logger';
import { AppError } from '../../../middlewares/error.middleware';
import { emitRoomCaptionsState } from '../../../socket/realtime';
import { extError } from '../../utils/ExtAppError';

/**
 * Live captions scaffold (Module 14 / ACCESS-001..003).
 *
 * Wraps an ASR provider (Whisper API or Deepgram) behind feature flags.
 * The mobile client streams audio chunks (PCM16 or Opus) to /ext/captions/stream
 * via WebSocket; the service relays them to the provider and broadcasts
 * the partial/final transcript back to the room.
 *
 * This module ships the room metadata + per-room captions ON/OFF flag.
 * The actual ASR streaming requires a paid API key — controlled by:
 *   - ASR_PROVIDER     : "whisper" | "deepgram"
 *   - ASR_API_KEY      : provider key
 *
 * When the key is missing, captions stay off and the mobile UI hides
 * the captions toggle.
 */

const flagKey = (roomId: string) => `ext:captions:enabled:${roomId}`;

export const captionsService = {
  isConfigured(): boolean {
    return Boolean(process.env.ASR_PROVIDER && process.env.ASR_API_KEY);
  },

  async setEnabled(
    callerId: string,
    roomId: string,
    enabled: boolean,
  ): Promise<{ enabled: boolean }> {
    if (!this.isConfigured()) {
      throw extError('PAY_NOT_CONFIGURED', 'ASR provider not configured');
    }
    // AuthZ: only the room host or a MODERATOR participant may toggle the
    // per-room captions flag. Mirrors chatmod.service's host/MODERATOR gate
    // so a random authenticated user cannot flip captions on someone else's
    // room (IDOR fix).
    const room = await prisma.room.findUnique({
      where: { id: roomId },
      select: { hostId: true },
    });
    if (!room) throw extError('CLUB_REQ_NOT_FOUND', 'Room not found');
    let allowed = room.hostId === callerId;
    if (!allowed) {
      const participant = await prisma.participant.findUnique({
        where: { userId_roomId: { userId: callerId, roomId } },
        select: { role: true },
      });
      allowed = participant?.role === 'MODERATOR';
    }
    if (!allowed) throw new AppError('AUTH_008', 'Not allowed');
    await redis.set(flagKey(roomId), enabled ? '1' : '0');
    // Live-propagate so listeners already in the room subscribe/unsubscribe the
    // caption stream without remounting.
    emitRoomCaptionsState(roomId, enabled);
    return { enabled };
  },

  async isEnabled(roomId: string): Promise<boolean> {
    const v = await redis.get(flagKey(roomId));
    return v === '1';
  },

  /**
   * Push an audio chunk to the configured ASR provider and return the
   * latest interim transcript. Stubbed — actual streaming happens via the
   * captions WebSocket handler, not this REST path.
   */
  async transcribe(_chunk: Buffer): Promise<{ text: string; isFinal: boolean }> {
    const provider = process.env.ASR_PROVIDER;
    if (!provider || !process.env.ASR_API_KEY) {
      throw extError('PAY_NOT_CONFIGURED', 'ASR provider not configured');
    }
    logger.info('ext.captions: transcribe stub called', { provider });
    return { text: '', isFinal: false };
  },
};
