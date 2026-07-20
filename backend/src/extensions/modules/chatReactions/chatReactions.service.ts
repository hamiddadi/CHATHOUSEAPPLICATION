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
const ALLOWED_LIST = [...ALLOWED];

const kBy = (id: string, emoji: string) => `ext:chatreact:${id}:by:${emoji}`;
const kUser = (id: string) => `ext:chatreact:${id}:user`;

export type ReactionsByEmoji = Record<string, { count: number; byMe: boolean }>;

const requireMessageAccess = async (callerId: string, messageId: string): Promise<void> => {
  const msg = await prisma.roomChatMessage.findFirst({
    where: {
      id: messageId,
      isDeleted: false,
      user: { deletedAt: null },
      room: {
        participants: {
          some: { userId: callerId, leftAt: null },
        },
      },
    },
    select: {
      room: {
        select: {
          chatVisibility: true,
          participants: {
            where: { userId: callerId, leftAt: null },
            select: { role: true },
            take: 1,
          },
        },
      },
    },
  });
  if (!msg) throw extError('CLUB_REQ_NOT_FOUND', 'Message not found');
  const role = msg.room.participants[0]?.role;
  if (msg.room.chatVisibility === 'MODS_ONLY' && role !== 'HOST' && role !== 'MODERATOR') {
    // Match roomsService.listRoomMessages: listeners cannot infer reactions
    // for chat history hidden from them.
    throw extError('CLUB_REQ_NOT_FOUND', 'Message not found');
  }
};

// One connection-local Lua operation keeps the reverse hash and all emoji
// sets coherent under concurrent taps/swaps. The previous HGET + separate
// writes could leave one user in multiple emoji sets.
const TOGGLE_SCRIPT = `
local caller = ARGV[1]
local nextEmoji = ARGV[2]
local ttl = tonumber(ARGV[3])
local previous = redis.call('HGET', KEYS[1], caller)

local function setIndex(label)
  for i = 4, #ARGV do
    if ARGV[i] == label then
      return i - 2
    end
  end
  return nil
end

if previous == nextEmoji then
  redis.call('HDEL', KEYS[1], caller)
  local oldIndex = setIndex(previous)
  if oldIndex then redis.call('SREM', KEYS[oldIndex], caller) end
else
  if previous then
    local oldIndex = setIndex(previous)
    if oldIndex then redis.call('SREM', KEYS[oldIndex], caller) end
  end
  redis.call('HSET', KEYS[1], caller, nextEmoji)
  local nextIndex = setIndex(nextEmoji)
  if nextIndex then redis.call('SADD', KEYS[nextIndex], caller) end
end

for i = 1, #KEYS do
  redis.call('EXPIRE', KEYS[i], ttl)
end
return 1
`;

const readReactions = async (callerId: string, messageId: string): Promise<ReactionsByEmoji> => {
  const myEmoji = await redis.hGet(kUser(messageId), callerId);
  const out: ReactionsByEmoji = {};
  const counts = await Promise.all(ALLOWED_LIST.map(emoji => redis.sCard(kBy(messageId, emoji))));
  ALLOWED_LIST.forEach((emoji, index) => {
    const count = counts[index] ?? 0;
    if (count > 0) out[emoji] = { count, byMe: myEmoji === emoji };
  });
  return out;
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
    await requireMessageAccess(callerId, messageId);
    await redis.eval(TOGGLE_SCRIPT, {
      keys: [kUser(messageId), ...ALLOWED_LIST.map(value => kBy(messageId, value))],
      arguments: [callerId, emoji, String(TTL_S), ...ALLOWED_LIST],
    });
    return readReactions(callerId, messageId);
  },

  async list(callerId: string, messageId: string): Promise<ReactionsByEmoji> {
    await requireMessageAccess(callerId, messageId);
    return readReactions(callerId, messageId);
  },
};
