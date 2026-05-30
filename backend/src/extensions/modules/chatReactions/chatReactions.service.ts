import { redis } from '../../../config/redis';
import { prisma } from '../../../config/database';
import { extError } from '../../utils/ExtAppError';

/**
 * Per-message chat reactions (Module 7.3 / CHAT-007).
 *
 * The existing `RoomReaction` model captures ambient float-up emojis;
 * this extension adds a separate "react to a specific chat message"
 * surface stored in Redis (no schema change). One user can place at most
 * one reaction per message; placing a different emoji replaces the
 * previous one (Clubhouse parity).
 *
 * Redis layout :
 *   ext:chatreact:<messageId>            HASH  emoji → count
 *   ext:chatreact:<messageId>:by:<emoji> SET   userIds
 *   ext:chatreact:<messageId>:user       HASH  userId → emoji  (reverse index for replace/remove)
 *   TTL 24h on every key — chat history is ephemeral
 */

const TTL_S = 24 * 3600;
const ALLOWED = new Set(['❤️', '👏', '🔥', '😂', '🙏', '🎉', '✨', '🤯']);

const kBy = (id: string, emoji: string) => `ext:chatreact:${id}:by:${emoji}`;
const kUser = (id: string) => `ext:chatreact:${id}:user`;

export type ReactionsByEmoji = Record<string, { count: number; byMe: boolean }>;

// Refresh the TTL on every key that backs a message's reactions, including
// each per-emoji SET (otherwise those SETs leak forever) — and call this in
// BOTH the add and the remove branches so the lifetime stays coherent.
const touchTTL = async (id: string): Promise<void> => {
  await Promise.all([
    redis.expire(kUser(id), TTL_S),
    ...[...ALLOWED].map(e => redis.expire(kBy(id, e), TTL_S)),
  ]);
};

export const chatReactionsService = {
  /**
   * Toggle a reaction: places the emoji if absent, removes it if the same
   * emoji was already there, swaps if the user had picked a different one.
   */
  async toggle(callerId: string, messageId: string, emoji: string): Promise<ReactionsByEmoji> {
    if (!ALLOWED.has(emoji)) {
      throw extError('PAY_INVALID', `Emoji "${emoji}" not in allowed set`);
    }
    // Make sure the message exists (so we don't store orphan reactions)
    const msg = await prisma.roomChatMessage.findUnique({
      where: { id: messageId },
      select: { id: true, isDeleted: true },
    });
    if (!msg || msg.isDeleted) {
      throw extError('CLUB_REQ_NOT_FOUND', 'Message not found');
    }

    // Source of truth for counts is the per-emoji SET (sAdd/sRem are
    // idempotent), NOT a hand-incremented HASH. With a separately
    // maintained counter, two concurrent toggles of the same emoji could
    // each read prevEmoji===emoji and decrement twice (negative count) or
    // both read "absent" and increment twice (double count). Deriving the
    // count from the SET via sCard() in list() removes that divergence.
    const prevEmoji = await redis.hGet(kUser(messageId), callerId);
    if (prevEmoji === emoji) {
      // Same emoji → remove
      await Promise.all([
        redis.hDel(kUser(messageId), callerId),
        redis.sRem(kBy(messageId, emoji), callerId),
      ]);
      await touchTTL(messageId);
    } else {
      // Different / new
      if (prevEmoji) {
        await redis.sRem(kBy(messageId, prevEmoji), callerId);
      }
      await Promise.all([
        redis.hSet(kUser(messageId), callerId, emoji),
        redis.sAdd(kBy(messageId, emoji), callerId),
      ]);
      await touchTTL(messageId);
    }

    return this.list(callerId, messageId);
  },

  async list(callerId: string, messageId: string): Promise<ReactionsByEmoji> {
    const myEmoji = await redis.hGet(kUser(messageId), callerId);
    const out: ReactionsByEmoji = {};
    // Count = cardinality of each idempotent SET — cannot go negative or
    // double-count under concurrency.
    const counts = await Promise.all([...ALLOWED].map(emoji => redis.sCard(kBy(messageId, emoji))));
    let i = 0;
    for (const emoji of ALLOWED) {
      const count = counts[i++] ?? 0;
      if (count <= 0) continue;
      out[emoji] = { count, byMe: myEmoji === emoji };
    }
    return out;
  },
};
