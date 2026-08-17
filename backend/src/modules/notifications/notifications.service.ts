import type {
  Notification,
  NotificationPreference,
  NotificationType,
  Prisma,
} from '@prisma/client';
import { prisma } from '../../config/database';
import { redis } from '../../config/redis';
import { logger } from '../../config/logger';
import { AppError } from '../../middlewares/error.middleware';
import { pushService } from '../push/push.service';
import { emitNotification, emitNotificationCount } from '../../socket/realtime';
import { notifPrefsExtService } from '../../extensions/modules/notifPrefsExt/notifPrefsExt.service';
import { scheduleBackgroundTask } from '../../utils/backgroundTasks';
import { decodeTimeIdCursor, encodeTimeIdCursor } from '../../utils/timeIdCursor';
import { wakeAndProcessOutbox } from '../../workers/outbox.worker';

const NOTIFICATION_DELIVERY_TOPIC = 'notification.deliver';

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
  FOLLOW_REQUEST: 'newFollower',
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

/**
 * Detects CLUB_INVITE notifications that are actually the *outcome of the
 * recipient's own join request* (approved / declined) rather than an
 * inbound invitation. These are reused under the CLUB_INVITE type by the
 * clubreq extension but carry a `kind` discriminator in their data payload.
 */
const isOwnClubRequestOutcome = (type: NotificationType, data?: unknown): boolean => {
  if (type !== 'CLUB_INVITE') return false;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  const kind = (data as Record<string, unknown>).kind;
  return kind === 'join_approved' || kind === 'join_declined';
};

/**
 * Pulls the originating Club id out of a notification's data payload so the
 * notifPrefsExt per-club mute can be consulted. Producers stash it as
 * `data.clubId` (see clubs.service). Returns null when absent or non-string.
 */
const extractClubId = (data?: unknown): string | null => {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const clubId = (data as Record<string, unknown>).clubId;
  return typeof clubId === 'string' ? clubId : null;
};

const isPushAllowed = async (
  userId: string,
  type: NotificationType,
  data?: unknown,
): Promise<boolean> => {
  // CLUB-08: the result of one's own join request is not an "invitation" —
  // it must not be silenced by the clubInvite push preference. Treat it as a
  // mandatory bucket so the requester always learns the outcome.
  if (isOwnClubRequestOutcome(type, data)) return true;
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
  rooms: [
    'ROOM_INVITE',
    'ROOM_STARTED',
    'ROOM_CANCELED',
    'ROOM_ENDED_BY_ADMIN',
    'HAND_ACCEPTED',
    'RSVP_REMINDER',
    'SPEAKER_REQUEST',
  ],
  social: ['NEW_FOLLOWER', 'FOLLOW_REQUEST', 'WAVE', 'NEW_MESSAGE', 'MENTION'],
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

const persistedNotificationStillExists = async (row: Notification): Promise<boolean> => {
  try {
    const stillExists = await prisma.notification.findUnique({
      where: { id: row.id },
      select: { id: true },
    });
    return stillExists !== null;
  } catch (err) {
    logger.warn('notification delivery revalidation failed; suppressing fanout', {
      err,
      notificationId: row.id,
      userId: row.userId,
    });
    return false;
  }
};

// The durable outbox must distinguish a genuinely revoked row from a
// transient database failure. Unlike the best-effort helper above, errors are
// allowed to propagate so the lease is retried instead of marked DELIVERED.
const persistedNotificationStillExistsStrict = async (row: Notification): Promise<boolean> => {
  const stillExists = await prisma.notification.findUnique({
    where: { id: row.id },
    select: { id: true },
  });
  return stillExists !== null;
};

const refreshUnreadCountStrict = async (userId: string): Promise<{ count: number }> => {
  const count = await prisma.notification.count({
    where: { userId, isRead: false },
  });
  await redis.set(unreadCacheKey(userId), String(count), { EX: UNREAD_CACHE_TTL });
  emitNotificationCount(userId, count);
  return { count };
};

export const notificationsService = {
  async list(userId: string, filter: NotificationFilter = 'all', limit = 50, cursor?: string) {
    const decodedCursor = cursor ? decodeTimeIdCursor(cursor) : null;
    if (cursor && !decodedCursor) throw new AppError('VALIDATION_001');
    const cursorWhere: Prisma.NotificationWhereInput = decodedCursor
      ? decodedCursor.id
        ? {
            OR: [
              { createdAt: { lt: decodedCursor.createdAt } },
              { createdAt: decodedCursor.createdAt, id: { lt: decodedCursor.id } },
            ],
          }
        : { createdAt: { lt: decodedCursor.createdAt } }
      : {};
    const where: Prisma.NotificationWhereInput = {
      userId,
      ...(filter !== 'all' ? { type: { in: FILTER_GROUPS[filter] } } : {}),
      ...cursorWhere,
    };
    const rows = await prisma.notification.findMany({
      where,
      // A timestamp alone is not unique. The id tie-breaker makes the order
      // total so equal-time rows are neither skipped nor repeated.
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1, // Fetch 1 extra for next-cursor detection
    });
    const hasMore = rows.length > limit;
    const data = hasMore ? rows.slice(0, limit) : rows;
    const last = data[data.length - 1];
    const nextCursor = hasMore && last ? encodeTimeIdCursor(last.createdAt, last.id) : null;
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

  /**
   * Rebuild and broadcast the unread badge after another domain deletes
   * notification rows in its own transaction (follow accept/reject/cancel).
   * Calling this after commit prevents a stale Redis value on other devices.
   */
  async refreshUnreadCount(userId: string) {
    try {
      const count = await prisma.notification.count({
        where: { userId, isRead: false },
      });
      try {
        await redis.set(unreadCacheKey(userId), String(count), { EX: UNREAD_CACHE_TTL });
      } catch (err) {
        // The relationship mutation is already committed. A cache outage must
        // not turn that success into a client-visible 500/retry ambiguity.
        logger.warn('notification unread cache refresh failed', { err, userId });
      }
      emitNotificationCount(userId, count);
      return { count };
    } catch (err) {
      logger.warn('notification unread recount failed after committed mutation', { err, userId });
      // Best effort: remove a possibly stale value if Redis itself is healthy.
      await redis.del(unreadCacheKey(userId)).catch(() => undefined);
      return null;
    }
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
    if (!n.isRead) await this.refreshUnreadCount(userId);
    return { deleted: true };
  },

  /**
   * Fans out a notification row that is already committed. `verifyExists` is
   * used by relationship transactions: if a later block/unfollow deleted the
   * row while delivery was queued, no stale socket/push is emitted. Delivery
   * is deliberately non-throwing because the durable row is the source of
   * truth and its creating transaction must never become an ambiguous 500.
   */
  async deliverPersisted(row: Notification, options: { verifyExists?: boolean } = {}) {
    if (options.verifyExists && !(await persistedNotificationStillExists(row))) return;

    try {
      emitNotification(row.userId, {
        id: row.id,
        type: row.type,
        title: row.title,
        body: row.body,
        data: row.data ?? undefined,
        createdAt: row.createdAt.toISOString(),
      });
    } catch (err) {
      logger.warn('notification socket fanout failed', {
        err,
        notificationId: row.id,
        userId: row.userId,
      });
    }

    if (options.verifyExists) {
      // Relationship notifications can be deleted by block/unfollow after the
      // existence check above. INCR would then resurrect a stale N+1 badge
      // after the deleting transaction had already published the exact N.
      // Recount instead. Revalidate once more after the DB-count/Redis-set
      // window; if deletion raced that window, a final recount repairs it and
      // the now-obsolete delivery stops here.
      await this.refreshUnreadCount(row.userId);
      if (!(await persistedNotificationStillExists(row))) {
        await this.refreshUnreadCount(row.userId);
        return;
      }
    } else {
      try {
        const key = unreadCacheKey(row.userId);
        let count = await redis.incr(key);
        if (count === 1) {
          count = await prisma.notification.count({
            where: { userId: row.userId, isRead: false },
          });
          await redis.set(key, String(count), { EX: UNREAD_CACHE_TTL });
        } else {
          await redis.expire(key, UNREAD_CACHE_TTL);
        }
        emitNotificationCount(row.userId, count);
      } catch (err) {
        logger.warn('notification badge fanout failed; rebuilding best effort', {
          err,
          notificationId: row.id,
          userId: row.userId,
        });
        await this.refreshUnreadCount(row.userId);
      }
    }

    try {
      await scheduleBackgroundTask(
        (async () => {
          if (!(await isPushAllowed(row.userId, row.type, row.data))) return;
          let extAllows = true;
          try {
            extAllows = await notifPrefsExtService.canDeliver(row.userId, row.type, {
              clubId: extractClubId(row.data),
              actorId: row.actorId ?? undefined,
            });
          } catch (err) {
            logger.warn('notifPrefsExt canDeliver failed; pushing anyway', {
              err,
              userId: row.userId,
            });
          }
          if (!extAllows) return;
          // Preference checks may involve Redis/DB I/O. A block or unfollow
          // can commit during that window, so close it with a final existence
          // check immediately before the external push dispatch.
          if (options.verifyExists && !(await persistedNotificationStillExists(row))) return;
          await pushService.dispatchToUser(row.userId, {
            title: row.title,
            body: row.body,
            data: {
              notificationId: row.id,
              type: row.type,
              ...(row.data && typeof row.data === 'object' && !Array.isArray(row.data)
                ? (row.data as Record<string, unknown>)
                : {}),
            },
          });
        })(),
        err => logger.warn('notif push dispatch failed', { err, userId: row.userId }),
      );
    } catch (err) {
      logger.warn('notification delivery scheduling failed', {
        err,
        notificationId: row.id,
        userId: row.userId,
      });
    }
  },

  /**
   * Outbox-only delivery path. Unlike the regular best-effort API, provider
   * and realtime errors propagate so the durable outbox can retry them. A
   * false result means the source row was revoked/deleted and is therefore a
   * successful no-op. External delivery remains at-least-once across crashes.
   */
  async deliverPersistedStrict(
    row: Notification,
    options: { verifyExists?: boolean } = {},
  ): Promise<boolean> {
    if (options.verifyExists && !(await persistedNotificationStillExistsStrict(row))) return false;

    emitNotification(row.userId, {
      id: row.id,
      type: row.type,
      title: row.title,
      body: row.body,
      data: row.data ?? undefined,
      createdAt: row.createdAt.toISOString(),
    });

    await refreshUnreadCountStrict(row.userId);
    if (options.verifyExists && !(await persistedNotificationStillExistsStrict(row))) {
      await refreshUnreadCountStrict(row.userId);
      return false;
    }

    if (!(await isPushAllowed(row.userId, row.type, row.data))) return true;
    const extAllows = await notifPrefsExtService.canDeliverDurably(row.userId, row.type, {
      deliveryId: row.id,
      clubId: extractClubId(row.data),
      actorId: row.actorId ?? undefined,
    });
    if (!extAllows) return true;
    if (options.verifyExists && !(await persistedNotificationStillExistsStrict(row))) return false;

    await pushService.dispatchToUser(row.userId, {
      title: row.title,
      body: row.body,
      data: {
        notificationId: row.id,
        type: row.type,
        ...(row.data && typeof row.data === 'object' && !Array.isArray(row.data)
          ? (row.data as Record<string, unknown>)
          : {}),
      },
    });
    return true;
  },

  /**
   * Atomically commits the durable notification and its delivery envelope.
   * `dedupeKey` should identify the originating domain event when one exists.
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
    dedupeKey?: string;
  }) {
    if (input.dedupeKey && input.dedupeKey.length > 191) {
      throw new AppError('VALIDATION_001', 'Notification deduplication key is too long');
    }
    const row = await prisma.$transaction(async tx => {
      const data = {
        userId: input.userId,
        actorId: input.actorId ?? null,
        type: input.type,
        title: input.title,
        body: input.body,
        data: input.data ?? undefined,
        targetId: input.targetId ?? null,
        targetType: input.targetType ?? null,
        dedupeKey: input.dedupeKey ?? null,
      } satisfies Prisma.NotificationUncheckedCreateInput;
      const notification = input.dedupeKey
        ? await tx.notification.upsert({
            where: { dedupeKey: input.dedupeKey },
            create: data,
            update: {},
          })
        : await tx.notification.create({ data });

      if (
        notification.userId !== input.userId ||
        notification.type !== input.type ||
        notification.actorId !== (input.actorId ?? null) ||
        notification.targetId !== (input.targetId ?? null) ||
        notification.targetType !== (input.targetType ?? null)
      ) {
        throw new AppError('VALIDATION_001', 'Notification deduplication key conflict');
      }

      await tx.outboxEvent.createMany({
        data: [
          {
            eventKey: `notification-delivery:${notification.id}`,
            topic: NOTIFICATION_DELIVERY_TOPIC,
            aggregateId: notification.id,
            payload: { notificationId: notification.id },
          },
        ],
        skipDuplicates: true,
      });
      return notification;
    });

    await wakeAndProcessOutbox(NOTIFICATION_DELIVERY_TOPIC, row.id).catch(err => {
      logger.warn('notification outbox wake failed; poller will retry', {
        err,
        notificationId: row.id,
        userId: row.userId,
      });
    });
    return row;
  },
};
