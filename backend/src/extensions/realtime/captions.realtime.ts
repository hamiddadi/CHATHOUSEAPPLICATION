import type { Server, Socket } from 'socket.io';
import { prisma } from '../../config/database';
import { roomChannel } from '../../socket/channels';
import { getUserId } from '../../socket/socket.middleware';
import { captionsService } from '../modules/captions/captions.service';

/**
 * Live-captions realtime relay (Module 16 / ACCESS-001..003).
 *
 * The transcript is produced ON-DEVICE (the speaker's client runs the
 * platform speech recogniser on its own mic). Each recognised line is sent up
 * as a `caption:publish` event; this relay authorises it and fans it out to
 * the whole room as `room:caption`, which the `useExtCaptions` hook already
 * listens for. No paid ASR key, no server audio pipeline.
 *
 * Authorisation, per line:
 *   - the socket must have joined the room channel;
 *   - captions must be ON for the room (host/mod toggled the Redis flag);
 *   - the caller must be a *speaking* participant (HOST/MODERATOR/SPEAKER).
 * The speaker role is cached per (socket, room) so interim lines (~5/s) don't
 * hammer Postgres; a demotion takes effect within AUTHZ_TTL_MS. A per-socket
 * token bucket caps abuse from a misbehaving client.
 */

interface CaptionPublishPayload {
  roomId?: unknown;
  id?: unknown;
  text?: unknown;
  isFinal?: unknown;
  speakerName?: unknown;
}

const SPEAKER_ROLES = new Set(['HOST', 'MODERATOR', 'SPEAKER']);
const MAX_TEXT = 500;
const MAX_ID = 64;
const MAX_NAME = 80;

const AUTHZ_TTL_MS = 8_000;
const authzCache = new Map<string, { until: number; allowed: boolean }>();

const RATE_WINDOW_MS = 1_000;
const RATE_MAX = 15;
const rate = new Map<string, { windowStart: number; count: number }>();

export const registerCaptionsRealtime = (io: Server, socket: Socket): void => {
  socket.on('caption:publish', async (payload: CaptionPublishPayload) => {
    try {
      const roomId = typeof payload?.roomId === 'string' ? payload.roomId : null;
      const id = typeof payload?.id === 'string' ? payload.id.slice(0, MAX_ID) : null;
      const text = typeof payload?.text === 'string' ? payload.text.slice(0, MAX_TEXT) : null;
      const isFinal = payload?.isFinal === true;
      const speakerName =
        typeof payload?.speakerName === 'string' ? payload.speakerName.slice(0, MAX_NAME) : null;
      if (!roomId || !id || text === null) return;

      // Joined the room channel? (cheap, in-memory)
      if (!socket.rooms.has(roomChannel(roomId))) return;

      // Per-socket rate limit.
      const now = Date.now();
      const rl = rate.get(socket.id);
      if (!rl || now - rl.windowStart >= RATE_WINDOW_MS) {
        rate.set(socket.id, { windowStart: now, count: 1 });
      } else if (++rl.count > RATE_MAX) {
        return;
      }

      // Captions enabled for this room?
      if (!(await captionsService.isEnabled(roomId))) return;

      const userId = getUserId(socket);

      // Speaker-role check (cached).
      const cacheKey = `${socket.id}:${roomId}`;
      const cached = authzCache.get(cacheKey);
      let allowed: boolean;
      if (cached && cached.until > now) {
        allowed = cached.allowed;
      } else {
        const p = await prisma.participant.findUnique({
          where: { userId_roomId: { userId, roomId } },
          select: { role: true },
        });
        allowed = p ? SPEAKER_ROLES.has(p.role) : false;
        authzCache.set(cacheKey, { until: now + AUTHZ_TTL_MS, allowed });
      }
      if (!allowed) return;

      // Server sets speakerId authoritatively (clients can only caption as
      // themselves). Shape matches the front `CaptionLine`.
      io.to(roomChannel(roomId)).emit('room:caption', {
        id,
        speakerId: userId,
        speakerName,
        text,
        isFinal,
        at: now,
      });
    } catch {
      /* best-effort — a bad caption line must never break the socket */
    }
  });

  socket.on('disconnect', () => {
    rate.delete(socket.id);
    const prefix = `${socket.id}:`;
    for (const key of authzCache.keys()) {
      if (key.startsWith(prefix)) authzCache.delete(key);
    }
  });
};
