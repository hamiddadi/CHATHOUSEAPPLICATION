import type { NotificationPreference, NotificationType, Prisma } from '@prisma/client';
import { prisma } from '../../config/database';
import { redis } from '../../config/redis';
import { logger } from '../../config/logger';
import { AppError } from '../../middlewares/error.middleware';
import { pushService } from '../push/push.service';
import { emitNotification, emitNotificationCount } from '../../socket/realtime';

/**
 * Maps a NotificationType to the matching boolean field on
 * NotificationPreference. When the user has flipped that toggle off,
 * the in-app row is still persisted (the bell stays accurate) but the
 * push dispatch is silenced — mirrors Clubhouse / iOS conventions.
 * Undefined means the type is system-mandatory and cannot be silenced
 * (e.g. moderation actions targeting the user).
 */
const PREF_FIELD_BY_TYPE: Partial<Record<NotificationType, keyof NotificationPreference>> = {
  NEW_FOLLOWER: 'newFollower',
  WAVE: 'wave',
  ROOM_INVITE: 'roomInvite',
  CLUB_INVITE: 'clubInvite',
  ROOM_STARTED: 'roomStarted',
  RSVP_REMINDER: 'eventReminder',
  NEW_MESSAGE: 'newMessage',
  HAND_ACCEPTED: 'handAccepted',
  MENTION: 'mention',
  // SPEAKER_REQUEST routed under roomInvite — same UX bucket.
  SPEAKER_REQUEST: 'roomInvite',
};

const isPushAllowed = async (userId: string, type: NotificationType): Promise<boolean> => {
  const field = PREF_FIELD_BY_TYPE[type];
  if (!field) return true; // Mandatory category
  const prefs = await prisma.notificationPreference.findUnique({
    where: { userId },
    select: { [field]: true } as Prisma.NotificationPreferenceSelect,
  });
  // Absence of a row = user never opened settings = defaults apply (all on).
  if (!prefs) return true;
  return prefs[field] !== false;
};

/**
 * Surface buckets exposed to the client. The frontend renders a tab
 * row (All / Rooms / Social / Clubs); each tab maps to a set of
 * NotificationType values. Kept in one place so the API contract and
 * the UI don't drift.
 */
const FILTER_GROUPS = {
  rooms: ['ROOM_INVITE', 'ROOM_STARTED', 'HAND_ACCEPTED', 'RSVP_REMINDER', 'SPEAKER_REQUEST'],
  social: ['NEW_FOLLOWER', 'WAVE', 'NEW_MESSAGE', 'MENTION'],
  clubs: ['CLUB_INVITE'],
} satisfies Record<string, NotificationType[]>;

export type NotificationFilter = keyof typeof FILTER_GROUPS | 'all';

/**
 * The complete set of filter values accepted by the notifications list
 * endpoint: every surface bucket plus the catch-all 'all'. Single source
 * of truth — the router validates incoming query strings against this
 * instead of re-listing the values.
 */
export const FILTER_VALUES: readonly NotificationFilter[] = [
  'all',
  ...(Object.keys(FILTER_GROUPS) as (keyof typeof FILTER_GROUPS)[]),
];

/**
 * Coerce a raw (untrusted) query value into a valid NotificationFilter,
 * falling back to 'all' for anything unrecognised — including non-string
 * values such as repeated query params.
 */
export const parseFilter = (raw: unknown): NotificationFilter =>
  typeof raw === 'string' && (FILTER_VALUES as readonly string[]).includes(raw)
    ? (raw as NotificationFilter)
    : 'all';

const unreadCacheKey = (userId: string) => `notif:unread:${userId}`;
const UNREAD_CACHE_TTL = 60; // 60s

export const notificationsService = {
  async list(userId: string, filter: NotificationFilter = 'all', limit = 50, cursor?: string) {
    const where: Prisma.NotificationWhereInput = {
      userId,
      ...(filter !== 'all' ? { type: { in: FILTER_GROUPS[filter] } } : {}),
      ...(cursor ? { createdAt: { lt: new Date(cursor) } } : {}),
    };
    const rows = await prisma.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit + 1, // Fetch 1 extra for next-cursor detection
    });
    const hasMore = rows.length > limit;
    const data = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? data[data.length - 1]?.createdAt.toISOString() : null;
    return { data, nextCursor, hasMore };
  },

  async unreadCount(userId: string) {
    // Check Redis cache first
    const cached = await redis.get(unreadCacheKey(userId));
    if (cached !== null) return { count: Number(cached) };

    const count = await prisma.notification.count({
      where: { userId, isRead: false },
    });
    await redis.set(unreadCacheKey(userId), String(count), { EX: UNREAD_CACHE_TTL });
    return { count };
  },

  async markOneRead(userId: string, id: string) {
    const n = await prisma.notification.findUnique({ where: { id } });
    if (!n || n.userId !== userId) throw new AppError('NOT_FOUND_001');
    if (!n.isRead) {
      await prisma.notification.update({
        where: { id },
        data: { isRead: true },
      });
      // Invalidate cache + emit new count
      await redis.del(unreadCacheKey(userId));
      const { count } = await this.unreadCount(userId);
      emitNotificationCount(userId, count);
    }
    return { read: true as const };
  },

  async markAllRead(userId: string) {
    const res = await prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true },
    });
    await redis.del(unreadCacheKey(userId));
    emitNotificationCount(userId, 0);
    return { updated: res.count };
  },

  async remove(userId: string, id: string) {
    const n = await prisma.notification.findUnique({ where: { id } });
    if (!n || n.userId !== userId) throw new AppError('NOT_FOUND_001');
    await prisma.notification.delete({ where: { id } });
    if (!n.isRead) {
      await redis.del(unreadCacheKey(userId));
    }
    return { deleted: true };
  },

  /**
   * Central entry point for every subsystem that raises a notification.
   * Creates the row AND kicks off a best-effort push dispatch + real-time
   * WS emission. Push/WS errors don't bubble — a failing delivery must
   * not abort the operation that triggered the notification.
   */
  async create(input: {
    userId: string;
    actorId?: string;
    type: NotificationType;
    title: string;
    body: string;
    data?: Prisma.InputJsonValue;
    targetId?: string;
    targetType?: string;
  }) {
    const row = await prisma.notification.create({
      data: {
        userId: input.userId,
        actorId: input.actorId ?? null,
        type: input.type,
        title: input.title,
        body: input.body,
        data: input.data ?? undefined,
        targetId: input.targetId ?? null,
        targetType: input.targetType ?? null,
      },
    });

    // Emit real-time notification over WebSocket
    emitNotification(input.userId, {
      id: row.id,
      type: input.type,
      title: input.title,
      body: input.body,
      data: input.data,
      createdAt: row.createdAt.toISOString(),
    });

    // Bump the unread badge. A freshly created notification is always
    // unread, so the cached count grows by exactly 1. Increment the cache
    // in place instead of re-running a full COUNT on every create (which
    // got hammered under reminder fan-out: one create per club member).
    const key = unreadCacheKey(input.userId);
    // Atomic INCR: creates the key at 1 if it was absent/expired. That single
    // op closes the get→incr race (where the TTL expired between the two calls
    // and the badge reset to 1). On a 1 result we self-heal by recomputing the
    // true unread count once and seeding the cache.
    let count = await redis.incr(key);
    if (count === 1) {
      count = await prisma.notification.count({
        where: { userId: input.userId, isRead: false },
      });
      await redis.set(key, String(count), { EX: UNREAD_CACHE_TTL });
    } else {
      await redis.expire(key, UNREAD_CACHE_TTL);
    }
    emitNotificationCount(input.userId, count);

    // Fire-and-forget push dispatch — gated on the user's per-type
    // preference. The in-app row above is always created so the bell
    // count stays accurate even when push is silenced.
    void (async () => {
      if (!(await isPushAllowed(input.userId, input.type))) return;
      await pushService.dispatchToUser(input.userId, {
        title: input.title,
        body: input.body,
        data: {
          notificationId: row.id,
          type: input.type,
          ...(input.data && typeof input.data === 'object' && !Array.isArray(input.data)
            ? (input.data as Record<string, unknown>)
            : {}),
        },
      });
    })().catch(err => logger.warn('notif push dispatch failed', { err, userId: input.userId }));
    return row;
  },
};
