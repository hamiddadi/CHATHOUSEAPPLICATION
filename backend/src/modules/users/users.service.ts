import { randomUUID } from 'node:crypto';
import { MediaKind, Prisma } from '@prisma/client';
import { prisma, runWriteWithRetry } from '../../config/database';
import { env } from '../../config/env';
import { logger } from '../../config/logger';
import { AppError } from '../../middlewares/error.middleware';
import {
  invalidateUserAuthCache,
  markUserDeletedInAuthCache,
} from '../../middlewares/auth.middleware';
import { disconnectUserSockets, emitMapUserMoved, emitMapUserOffline } from '../../socket/realtime';
import { cancelEventReminder } from '../../queues/eventReminders';
import { getBlockedIdSet } from '../social/blocks';
import { roomsService } from '../rooms/rooms.service';
import { mediaService } from '../media/media.service';
import {
  restoreStripeSubscription,
  scheduleStripeCancellation,
} from '../../extensions/modules/payments/stripe.gdpr';
import { scheduleBackgroundTask } from '../../utils/backgroundTasks';
import { REFRESH_TTL_DAYS } from '../../utils/issueTokenPair';
import { signAccessToken, signRefreshToken } from '../../utils/jwt';
import { legalAcceptanceSelect, legalAcceptanceStatus } from '../auth/legal-acceptance';
import { locationsForViewer } from './location-privacy';
import type {
  CompleteOnboardingInput,
  ContactDiscoveryInput,
  InterestsInput,
  LocationInput,
  NotifPrefsInput,
  SearchQueryInput,
  SetUsernameInput,
  UpdateMeInput,
  UsernameAvailabilityInput,
  VisibilityInput,
} from './users.schema';

const publicSelect = {
  id: true,
  username: true,
  displayName: true,
  firstName: true,
  lastName: true,
  avatarUrl: true,
  avatarThumb: true,
  bio: true,
  twitter: true,
  instagram: true,
  isOnline: true,
  currentRoomId: true,
  followerCount: true,
  followingCount: true,
  createdAt: true,
} as const;

const meSelect = {
  ...publicSelect,
  email: true,
  phoneNumber: true,
  isVisible: true,
  allowContactDiscovery: true,
  allowWaves: true,
  isPrivateAccount: true,
  dmPrivacy: true,
  latitude: true,
  longitude: true,
  lastSeenAt: true,
  interests: true,
  hasCompletedOnboarding: true,
  deletedAt: true,
  ...legalAcceptanceSelect,
} as const;

// Only surface users seen within this window on the live map.
const ONLINE_WINDOW_MS = 30 * 60 * 1000;
// Grace period between a deletion request and the permanent purge.
const DELETION_GRACE_MS = env.ACCOUNT_DELETION_GRACE_DAYS * 24 * 60 * 60 * 1000;
// Hard caps on how many pins a single map query materialises.
const ONLINE_MAP_LIMIT = 200;
const FOLLOWING_MAP_LIMIT = 500;

export interface MapUserSnapshot {
  id: string;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  latitude: number;
  longitude: number;
  lastSeenAt: Date;
  currentRoomId: string | null;
  currentRoom: { id: string; title: string; isLive: boolean } | null;
}

// Canonical interest list: trimmed, lowercased, de-duplicated.
const normaliseInterests = (xs: string[]): string[] => [
  ...new Set(xs.map(i => i.trim().toLowerCase())),
];

export const usersService = {
  async getMe(userId: string) {
    const me = await prisma.user.findUnique({ where: { id: userId }, select: meSelect });
    if (!me) throw new AppError('USER_001');
    return {
      ...me,
      accountState: me.deletedAt ? ('PENDING_DELETION' as const) : ('ACTIVE' as const),
      permanentDeletionAt: me.deletedAt
        ? new Date(me.deletedAt.getTime() + DELETION_GRACE_MS).toISOString()
        : null,
      ...legalAcceptanceStatus(me),
    };
  },

  async updateMe(userId: string, input: UpdateMeInput) {
    // Store social handles bare: strip a leading '@' so the value stays
    // canonical (the profile UI re-adds '@' when displaying / building links).
    // An empty string clears the handle (column is nullable VarChar(50)).
    const data: Prisma.UserUpdateInput = { ...input };
    if (input.avatarUrl !== undefined) {
      data.avatarUrl = await mediaService.assertOwnedMediaUrl(
        userId,
        input.avatarUrl,
        MediaKind.AVATAR,
      );
    }
    if (input.twitter !== undefined) data.twitter = input.twitter.replace(/^@+/, '');
    if (input.instagram !== undefined) data.instagram = input.instagram.replace(/^@+/, '');
    return prisma.user.update({ where: { id: userId }, data, select: meSelect });
  },

  async setVisibility(userId: string, input: VisibilityInput) {
    const result = await prisma.user.update({
      where: { id: userId },
      data: input.isVisible
        ? { isVisible: true }
        : {
            isVisible: false,
            latitude: null,
            longitude: null,
          },
      select: { id: true, isVisible: true },
    });
    if (!result.isVisible) await emitMapUserOffline(userId);
    return result;
  },

  async setLocation(userId: string, input: LocationInput): Promise<MapUserSnapshot> {
    const written = await prisma.user.updateMany({
      where: { id: userId, isVisible: true, deletedAt: null },
      data: {
        latitude: input.latitude,
        longitude: input.longitude,
        lastSeenAt: new Date(),
      },
    });
    if (written.count !== 1) throw new AppError('MAPS_001');

    const result = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        username: true,
        displayName: true,
        avatarUrl: true,
        latitude: true,
        longitude: true,
        lastSeenAt: true,
        currentRoomId: true,
        currentRoom: { select: { id: true, title: true, isLive: true } },
      },
    });
    if (
      !result ||
      result.latitude === null ||
      result.longitude === null ||
      result.lastSeenAt === null
    ) {
      throw new AppError('MAPS_001');
    }
    const snapshot = result as MapUserSnapshot;
    await emitMapUserMoved({
      userId: snapshot.id,
      username: snapshot.username,
      displayName: snapshot.displayName,
      avatarUrl: snapshot.avatarUrl,
      latitude: snapshot.latitude,
      longitude: snapshot.longitude,
      lastSeenAt: snapshot.lastSeenAt.toISOString(),
      currentRoomId: snapshot.currentRoomId,
      currentRoom: snapshot.currentRoom,
    });
    return snapshot;
  },

  /**
   * Presence touch — flips isOnline and refreshes lastSeenAt. Driven by the
   * socket presence handler (connect / `presence_update` heartbeat / disconnect)
   * and the POST /users/me/heartbeat fallback. Keeps discovery surfaces
   * (explore featured users, available-people strip, map) reflecting reality.
   */
  async touchPresence(userId: string, online: boolean) {
    const updated = await runWriteWithRetry(() =>
      prisma.user.updateMany({
        // A disconnect callback can outlive a test/user purge. updateMany keeps
        // that cleanup idempotent, and never brings a soft-deleted account back
        // into discovery while its deletion grace period is running.
        where: { id: userId, deletedAt: null },
        data: { isOnline: online, lastSeenAt: new Date() },
      }),
    );
    return { online: updated.count === 1 ? online : false };
  },

  async getById(id: string, viewerId?: string) {
    // A block is a symmetric break: a blocked user's profile must not be
    // readable by the other party. Also hide soft-deleted accounts.
    let blockedIds = new Set<string>();
    if (viewerId && viewerId !== id) {
      blockedIds = await getBlockedIdSet(viewerId);
      if (blockedIds.has(id)) throw new AppError('USER_001');
    }
    const user = await prisma.user.findFirst({
      where: { id, deletedAt: null },
      // Inline the inviter relation here (not in the shared publicSelect) so
      // the "Nominated by @inviter" line rides on the detail payload without
      // adding a join to every search-result row.
      select: {
        ...publicSelect,
        invitedBy: {
          select: {
            id: true,
            username: true,
            displayName: true,
            deletedAt: true,
          },
        },
      },
    });
    if (!user) throw new AppError('USER_001');

    // #76: record the visit so the viewed user can later see who looked at
    // their profile. Non-blocking in production and drainable at shutdown.
    if (viewerId && viewerId !== id) {
      await scheduleBackgroundTask(
        prisma.profileView.upsert({
          where: { viewerId_viewedUserId: { viewerId, viewedUserId: id } },
          create: { viewerId, viewedUserId: id },
          update: { viewedAt: new Date() },
        }),
        err => logger.warn('profile view persistence failed', { err, viewerId, viewedUserId: id }),
      );
    }

    // Per-viewer relationship state so the client can render Follow,
    // Requested or Following without a second round-trip. This only exposes
    // the viewer's own outgoing edge, never somebody else's pending requests.
    let isFollowedByMe = false;
    let followRequestedByMe = false;
    if (viewerId && viewerId !== id) {
      const rel = await prisma.follow.findUnique({
        where: { followerId_followingId: { followerId: viewerId, followingId: id } },
        select: { status: true },
      });
      isFollowedByMe = rel?.status === 'ACCEPTED';
      followRequestedByMe = rel?.status === 'PENDING';
    }
    const { invitedBy, ...profile } = user;
    const visibleInviter =
      invitedBy && !invitedBy.deletedAt && !blockedIds.has(invitedBy.id)
        ? {
            id: invitedBy.id,
            username: invitedBy.username,
            displayName: invitedBy.displayName,
          }
        : null;
    return {
      ...profile,
      invitedBy: visibleInviter,
      isFollowedByMe,
      followRequestedByMe,
    };
  },

  /**
   * #76: distinct users who recently viewed my profile, newest visit first.
   * Premium-gated — non-premium callers get PREMIUM_001.
   */
  async listProfileViewers(userId: string, limit = 30) {
    const me = await prisma.user.findUnique({
      where: { id: userId },
      select: { isPremium: true },
    });
    if (!me?.isPremium) throw new AppError('PREMIUM_001');
    const blocked = await getBlockedIdSet(userId);
    const rows = await prisma.profileView.findMany({
      where: {
        viewedUserId: userId,
        ...(blocked.size > 0 ? { viewerId: { notIn: [...blocked] } } : {}),
        viewer: { deletedAt: null },
      },
      orderBy: { viewedAt: 'desc' },
      take: Math.min(limit, 100),
      include: {
        viewer: { select: { id: true, username: true, displayName: true, avatarUrl: true } },
      },
    });
    return rows.map(r => ({ viewedAt: r.viewedAt.toISOString(), user: r.viewer }));
  },

  async checkUsername(input: UsernameAvailabilityInput) {
    const username = input.q.toLowerCase();
    // Keep the application safe while older databases are being upgraded to
    // a unique lower(username) index. `findUnique` uses PostgreSQL's
    // case-sensitive text equality and would miss an existing "Alice".
    const existing = await prisma.user.findFirst({
      where: { username: { equals: username, mode: 'insensitive' } },
      select: { id: true },
    });
    return { available: existing === null };
  },

  /**
   * Suggest usernames based on a base string. Returns up to 5 available
   * alternatives by appending random digits.
   */
  async suggestUsername(base: string) {
    const candidates: string[] = [];
    const baseLower = base
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, '')
      .slice(0, 18);
    for (let i = 0; i < 5; i++) {
      const suffix = Math.floor(Math.random() * 9999)
        .toString()
        .padStart(2, '0');
      candidates.push(`${baseLower}${suffix}`);
    }
    const taken = await prisma.user.findMany({
      where: { username: { in: candidates } },
      select: { username: true },
    });
    const takenSet = new Set(taken.map(u => u.username));
    return { suggestions: candidates.filter(c => !takenSet.has(c)) };
  },

  async setUsername(userId: string, input: SetUsernameInput) {
    const username = input.username.toLowerCase();
    const existing = await prisma.user.findFirst({
      where: { username: { equals: username, mode: 'insensitive' } },
      select: { id: true },
    });
    if (existing && existing.id !== userId) throw new AppError('USER_002');
    try {
      return await prisma.user.update({
        where: { id: userId },
        data: {
          username,
          // Default displayName to the username on first set, so the UI always
          // has something to show. User can refine via PATCH /users/me.
          displayName: username,
        },
        select: meSelect,
      });
    } catch (err) {
      // The DB unique constraint closes the race between the availability
      // lookup and update; expose a stable domain error instead of a 500.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new AppError('USER_002');
      }
      throw err;
    }
  },

  async getContactDiscovery(userId: string) {
    const user = await prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { allowContactDiscovery: true },
    });
    if (!user) throw new AppError('USER_001');
    return user;
  },

  async setContactDiscovery(userId: string, input: ContactDiscoveryInput) {
    return prisma.user.update({
      where: { id: userId },
      data: { allowContactDiscovery: input.allowContactDiscovery },
      select: { allowContactDiscovery: true },
    });
  },

  async search(input: SearchQueryInput, viewerId?: string) {
    const term = input.q.trim();
    // Exclude blocked/blocking users and soft-deleted accounts, consistent
    // with search.service / explore.service (a block is symmetric everywhere).
    const blocked = viewerId ? await getBlockedIdSet(viewerId) : new Set<string>();
    return prisma.user.findMany({
      where: {
        deletedAt: null,
        id: { notIn: [...blocked] },
        OR: [
          { username: { contains: term, mode: 'insensitive' } },
          { displayName: { contains: term, mode: 'insensitive' } },
        ],
      },
      select: publicSelect,
      take: input.limit,
      orderBy: { username: 'asc' },
    });
  },

  async setInterests(userId: string, input: InterestsInput) {
    // Lowercase + dedupe server-side so the list stored is canonical,
    // regardless of how the client sends it.
    const normalised = normaliseInterests(input.interests);
    return prisma.user.update({
      where: { id: userId },
      data: { interests: normalised },
      select: meSelect,
    });
  },

  async completeOnboarding(userId: string, input: CompleteOnboardingInput) {
    const data: Prisma.UserUpdateInput = {
      hasCompletedOnboarding: true,
    };
    if (input.displayName !== undefined) data.displayName = input.displayName;
    if (input.firstName !== undefined) data.firstName = input.firstName;
    if (input.lastName !== undefined) data.lastName = input.lastName;
    if (input.bio !== undefined) data.bio = input.bio;
    if (input.avatarUrl !== undefined) {
      if (input.avatarUrl !== null) {
        data.avatarUrl = await mediaService.assertOwnedMediaUrl(
          userId,
          input.avatarUrl,
          MediaKind.AVATAR,
        );
      } else {
        data.avatarUrl = null;
      }
    }
    if (input.interests !== undefined) {
      data.interests = normaliseInterests(input.interests);
    }
    return prisma.user.update({
      where: { id: userId },
      data,
      select: meSelect,
    });
  },

  async getOnlineLocations(viewerId: string) {
    // Exclude ghost-mode users and the viewer themself. Only users with
    // recorded coordinates and seen in the last 30 min are surfaced.
    // CRITICAL: also exclude blocked/blocking users — the map is the most
    // sensitive surface (precise GPS), so a blocked harasser must never be
    // able to locate (or be located by) the viewer. And hide soft-deleted.
    const thirtyMinAgo = new Date(Date.now() - ONLINE_WINDOW_MS);
    const blocked = await getBlockedIdSet(viewerId);
    const rows = await prisma.user.findMany({
      where: {
        isVisible: true,
        isOnline: true,
        deletedAt: null,
        id: { notIn: [viewerId, ...blocked] },
        latitude: { not: null },
        longitude: { not: null },
        lastSeenAt: { gte: thirtyMinAgo },
      },
      select: {
        id: true,
        username: true,
        displayName: true,
        avatarUrl: true,
        latitude: true,
        longitude: true,
        lastSeenAt: true,
        currentRoomId: true,
        currentRoom: { select: { id: true, title: true, isLive: true } },
      },
      take: ONLINE_MAP_LIMIT,
    });
    return locationsForViewer(viewerId, rows);
  },

  /**
   * Snapshot of the people the caller FOLLOWS who are on the map right now:
   * visible (Ghost Mode off), online, with coordinates, seen in the last
   * 30 min. Excludes blocked/blocking users and soft-deleted accounts.
   *
   * This is the initial roster for the maps feature — the WebSocket only
   * streams coordinate deltas (maps:user-moved/-offline) and can't materialise
   * a new pin (no username/avatar in the payload), so the client seeds from
   * this and then relocates known followers live.
   */
  async getFollowingOnMap(viewerId: string) {
    const thirtyMinAgo = new Date(Date.now() - ONLINE_WINDOW_MS);
    const blocked = await getBlockedIdSet(viewerId);
    const follows = await prisma.follow.findMany({
      where: { followerId: viewerId, status: 'ACCEPTED' },
      select: { followingId: true },
    });
    const ids = follows.map(f => f.followingId).filter(id => !blocked.has(id));
    if (ids.length === 0) return [];
    const rows = await prisma.user.findMany({
      where: {
        id: { in: ids },
        isVisible: true,
        isOnline: true,
        deletedAt: null,
        latitude: { not: null },
        longitude: { not: null },
        lastSeenAt: { gte: thirtyMinAgo },
      },
      select: {
        id: true,
        username: true,
        displayName: true,
        avatarUrl: true,
        latitude: true,
        longitude: true,
        lastSeenAt: true,
        currentRoomId: true,
        // Live-room badge on the pin (only meaningful while the room is live).
        currentRoom: { select: { id: true, title: true, isLive: true } },
      },
      take: FOLLOWING_MAP_LIMIT,
    });
    return locationsForViewer(viewerId, rows);
  },

  // ─── Account Deletion (30-day soft delete) ─────────────
  async requestDeletion(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { deletedAt: true },
    });
    if (!user) throw new AppError('USER_001');
    if (user.deletedAt) throw new AppError('ACCOUNT_001');

    const deletedAt = new Date();
    const [scheduled] = await prisma.$transaction([
      prisma.user.updateMany({
        where: { id: userId, deletedAt: null },
        data: {
          deletedAt,
          isVisible: false,
          isOnline: false,
          latitude: null,
          longitude: null,
          currentRoomId: null,
          tokenVersion: { increment: 1 },
        },
      }),
      prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: deletedAt },
      }),
      prisma.pushToken.deleteMany({ where: { userId } }),
    ]);
    if (scheduled.count !== 1) throw new AppError('ACCOUNT_001');

    // Close live realtime authority immediately after the database commit,
    // before any fallible post-commit cache or cleanup work can yield.
    try {
      disconnectUserSockets(userId, 'account_deleted');
    } catch (err) {
      logger.error('account-deletion: failed to disconnect live sockets', {
        userId,
        err: err instanceof Error ? err.message : String(err),
      });
    }
    await markUserDeletedInAuthCache(userId).catch(err => {
      // tokenVersion/deletedAt are already authoritative in PostgreSQL. Redis
      // acceleration must never turn a committed deletion into a misleading
      // 500 or prevent the remaining cleanup from running.
      logger.error('account-deletion: failed to mark deleted auth cache', {
        userId,
        err: err instanceof Error ? err.message : String(err),
      });
    });

    // Marking the account deleted happens before room cleanup. This ordering
    // closes the race with scheduled go-live: its Room -> User transaction
    // either commits first (and the active participant is found below) or sees
    // deletedAt and cancels the event itself.
    const activeParticipations = await prisma.participant.findMany({
      where: { userId, leftAt: null },
      select: { roomId: true },
    });
    for (const participation of activeParticipations) {
      try {
        await roomsService.leave(participation.roomId, userId);
      } catch (err) {
        logger.error('account-deletion: failed to leave active room', {
          err,
          userId,
          roomId: participation.roomId,
        });
      }
    }

    // Heal any legacy live room whose host participant/currentRoom pointer was
    // missing. A deleted account must never leave a live room under its
    // ownership.
    const orphanHostedRooms = await prisma.room.findMany({
      where: { hostId: userId, isLive: true, endedAt: null },
      select: { id: true },
    });
    for (const room of orphanHostedRooms) {
      try {
        await roomsService.end(room.id, userId);
      } catch (err) {
        logger.error('account-deletion: failed to close hosted room', {
          err,
          userId,
          roomId: room.id,
        });
      }
    }

    // Future events are canceled, not merely hidden. Otherwise a reminder job
    // could expire during the grace period and leave an unstartable event that
    // reappears after login restoration.
    const futureEvents = await prisma.room.findMany({
      where: {
        hostId: userId,
        isLive: false,
        endedAt: null,
        scheduledFor: { not: null },
      },
      select: { id: true },
    });
    if (futureEvents.length > 0) {
      const eventIds = futureEvents.map(room => room.id);
      await prisma.room.updateMany({
        where: {
          id: { in: eventIds },
          hostId: userId,
          isLive: false,
          endedAt: null,
        },
        data: {
          endedAt: deletedAt,
          canceledAt: deletedAt,
          participantCount: 0,
        },
      });
      const queueResults = await Promise.allSettled(eventIds.map(cancelEventReminder));
      queueResults.forEach((result, index) => {
        if (result.status === 'rejected') {
          logger.warn('account-deletion: failed to cancel event jobs', {
            err: result.reason,
            userId,
            roomId: eventIds[index],
          });
        }
      });
    }

    await scheduleStripeCancellation(userId).catch(err => {
      // The account is already disabled. The daily GDPR worker retries this so
      // a transient Stripe outage never undoes the deletion request.
      logger.error('account-deletion: failed to schedule subscription cancellation', {
        userId,
        err: err instanceof Error ? err.message : String(err),
      });
    });
    return {
      deletedAt: deletedAt.toISOString(),
      permanentDeletionAt: new Date(deletedAt.getTime() + DELETION_GRACE_MS).toISOString(),
    };
  },

  async cancelDeletion(userId: string) {
    // MODE-08: only reactivate accounts the USER themselves scheduled for
    // deletion. An admin soft-delete (admin.deleteUser) sets `deletedAt`
    // alongside a permanent `suspendedUntil` ban; a self-requested deletion
    // (requestDeletion) sets `deletedAt` only. So an active suspension marks an
    // admin-origin deletion that this self-service endpoint must not lift —
    // otherwise a user could undo a moderator's ban by cancelling "deletion".
    const now = new Date();
    const cutoff = new Date(now.getTime() - DELETION_GRACE_MS);
    const refreshJti = randomUUID();
    const refreshExpiresAt = new Date(now.getTime() + REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000);
    const restored = await runWriteWithRetry(() =>
      prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR NO KEY UPDATE`;
        const user = await tx.user.findUnique({
          where: { id: userId },
          select: { deletedAt: true, suspendedUntil: true },
        });
        if (!user) throw new AppError('USER_001');
        if (user.suspendedUntil && user.suspendedUntil > now) {
          throw new AppError('AUTH_007');
        }
        if (!user.deletedAt || user.deletedAt <= cutoff) {
          throw new AppError('AUTH_003');
        }

        // Rotate the authorization boundary atomically with restoration. Every
        // recovery access token carries the old tokenVersion and every recovery
        // refresh row is revoked before a new active family is issued below.
        const restoredUser = await tx.user.update({
          where: { id: userId },
          data: { deletedAt: null, tokenVersion: { increment: 1 } },
          select: { ...meSelect, tokenVersion: true },
        });
        await tx.refreshToken.updateMany({
          where: { userId, revokedAt: null },
          data: { revokedAt: now },
        });
        // The replacement credential must commit atomically with restoration.
        // If this INSERT fails, PostgreSQL rolls deletedAt/tokenVersion back and
        // the caller's recovery bearer remains retryable.
        await tx.refreshToken.create({
          data: { token: refreshJti, userId, expiresAt: refreshExpiresAt },
        });
        return restoredUser;
      }),
    );
    // Cache coherence is post-commit and best-effort. Failing Redis must not
    // turn a successful, atomically credentialed restoration into an opaque
    // 500 that the now-revoked recovery session cannot retry.
    await invalidateUserAuthCache(userId).catch(err => {
      logger.warn('account-restoration: failed to invalidate auth cache', {
        userId,
        err: err instanceof Error ? err.message : String(err),
      });
    });
    await restoreStripeSubscription(userId).catch(err => {
      logger.warn('account-restoration: failed to resume pending Stripe subscription', {
        userId,
        err: err instanceof Error ? err.message : String(err),
      });
    });
    // Signing is pure and uses the tokenVersion/jti already committed above;
    // there is no fallible database step between restoration and the response.
    const { tokenVersion, ...restoredUser } = restored;
    const tokens = {
      accessToken: signAccessToken(userId, tokenVersion),
      refreshToken: signRefreshToken(userId, refreshJti),
      scope: 'active' as const,
    };
    return {
      cancelled: true as const,
      session: {
        ...tokens,
        expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      },
      user: {
        ...restoredUser,
        accountState: 'ACTIVE' as const,
        permanentDeletionAt: null,
        ...legalAcceptanceStatus(restoredUser),
      },
    };
  },

  // ─── Notification Preferences ──────────────────────────
  async getNotificationPreferences(userId: string) {
    // Prisma does not delegate an upsert with an empty update to PostgreSQL;
    // concurrent first reads can therefore still race with P2002. Emit an
    // actual INSERT ... ON CONFLICT DO NOTHING, then load the single winner.
    await prisma.notificationPreference.createMany({
      data: [{ userId }],
      skipDuplicates: true,
    });
    return prisma.notificationPreference.findUniqueOrThrow({ where: { userId } });
  },

  async updateNotificationPreferences(userId: string, input: NotifPrefsInput) {
    return prisma.notificationPreference.upsert({
      where: { userId },
      create: { userId, ...input },
      update: input,
    });
  },
};
