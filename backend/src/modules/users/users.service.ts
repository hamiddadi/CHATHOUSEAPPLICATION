import { MediaKind, type Prisma } from '@prisma/client';
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
import { expiringMediaUrlFor } from '../media/media-url';
import { mediaService } from '../media/media.service';
import {
  restoreStripeSubscription,
  scheduleStripeCancellation,
} from '../../extensions/modules/payments/stripe.gdpr';
import { exportExtensionData } from '../../extensions/gdpr';
import { scheduleBackgroundTask } from '../../utils/backgroundTasks';
import { legalAcceptanceSelect, legalAcceptanceStatus } from '../auth/legal-acceptance';
import { locationsForViewer } from './location-privacy';
import type {
  CompleteOnboardingInput,
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

type ExportMediaReference = { mediaId: string; downloadUrl: string } | { externalUrl: string };

const mediaIdFromInternalUrl = (value: string): string | null => {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }

  // In production, never reinterpret a URL hosted by another origin as one of
  // our private-media capabilities. Local/test deployments may not have a
  // stable PUBLIC_URL, so the canonical /media path remains the fallback.
  if (env.PUBLIC_URL && parsed.origin !== new URL(env.PUBLIC_URL).origin) {
    return null;
  }

  const parts = parsed.pathname.split('/').filter(Boolean);
  const isStableCapability = parts.length === 3;
  const isExpiringCapability = parts.length === 4 && /^\d{10}$/.test(parts[2] ?? '');
  const mediaId = parts[1];
  if (
    parts[0] !== 'media' ||
    (!isStableCapability && !isExpiringCapability) ||
    !mediaId ||
    !parts.at(-1)
  ) {
    return null;
  }
  try {
    return decodeURIComponent(mediaId);
  } catch {
    return null;
  }
};

const mediaReferenceForExport = (
  value: string | null,
  requestOrigin: string,
): ExportMediaReference | null => {
  if (!value) return null;
  const mediaId = mediaIdFromInternalUrl(value);
  if (!mediaId) return { externalUrl: value };
  return {
    mediaId,
    downloadUrl: expiringMediaUrlFor(mediaId, requestOrigin),
  };
};

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
      await mediaService.assertOwnedMediaUrl(userId, input.avatarUrl, MediaKind.AVATAR);
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

    // Per-viewer relationship flag so the client can render Follow/Following
    // without a second round-trip. Cheap indexed lookup on the unique pair.
    let isFollowedByMe = false;
    if (viewerId && viewerId !== id) {
      const rel = await prisma.follow.findFirst({
        where: { followerId: viewerId, followingId: id, status: 'ACCEPTED' },
        select: { followerId: true },
      });
      isFollowedByMe = rel !== null;
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
    return { ...profile, invitedBy: visibleInviter, isFollowedByMe };
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
    const existing = await prisma.user.findUnique({
      where: { username: input.q },
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
    const existing = await prisma.user.findUnique({
      where: { username: input.username },
      select: { id: true },
    });
    if (existing && existing.id !== userId) throw new AppError('USER_002');
    return prisma.user.update({
      where: { id: userId },
      data: {
        username: input.username,
        // Default displayName to the username on first set, so the UI always
        // has something to show. User can refine via PATCH /users/me.
        displayName: input.username,
      },
      select: meSelect,
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
        await mediaService.assertOwnedMediaUrl(userId, input.avatarUrl, MediaKind.AVATAR);
      }
      data.avatarUrl = input.avatarUrl;
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

    await markUserDeletedInAuthCache(userId);
    disconnectUserSockets(userId, 'account_deleted');

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
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { suspendedUntil: true },
    });
    if (!user) throw new AppError('USER_001');
    if (user.suspendedUntil && user.suspendedUntil > new Date()) {
      throw new AppError('AUTH_007');
    }
    // Restore only from a self-requested deletion. The updateMany guard keeps
    // this atomic against a concurrent admin ban landing between the read and
    // the write (the active-suspension condition is re-checked by the DB).
    const now = new Date();
    await prisma.user.updateMany({
      where: {
        id: userId,
        OR: [{ suspendedUntil: null }, { suspendedUntil: { lt: now } }],
      },
      data: { deletedAt: null },
    });
    await invalidateUserAuthCache(userId);
    await restoreStripeSubscription(userId).catch(err => {
      logger.warn('account-restoration: failed to resume pending Stripe subscription', {
        userId,
        err: err instanceof Error ? err.message : String(err),
      });
    });
    return { cancelled: true };
  },

  // ─── Notification Preferences ──────────────────────────
  async getNotificationPreferences(userId: string) {
    const prefs = await prisma.notificationPreference.findUnique({ where: { userId } });
    if (!prefs) {
      // Return defaults
      return prisma.notificationPreference.create({ data: { userId } });
    }
    return prefs;
  },

  async updateNotificationPreferences(userId: string, input: NotifPrefsInput) {
    return prisma.notificationPreference.upsert({
      where: { userId },
      create: { userId, ...input },
      update: input,
    });
  },

  /**
   * GDPR Articles 15/20 — access and portability. The export deliberately
   * denormalizes every user-facing domain so it remains readable without
   * knowledge of the database schema. Authentication secrets, raw push tokens
   * and private object-storage keys are never exported.
   */
  async exportData(userId: string, requestOrigin: string) {
    const [
      profile,
      hostedRooms,
      participations,
      followers,
      following,
      directMessages,
      legacyRoomMessages,
      roomChatMessages,
      groupMemberships,
      groupMessages,
      rsvps,
      pushTokens,
      notifPrefs,
      notificationsReceived,
      notificationsTriggered,
      handRaises,
      reactions,
      blocksCreated,
      reportsFiled,
      ownedClubs,
      clubMemberships,
      tipsSent,
      tipsReceived,
      subscription,
      profileViewsGiven,
      profileViewsReceived,
      roomBansIssued,
      roomBansReceived,
      invitedUsers,
      auditEvents,
      idempotentOperations,
      mediaObjects,
      extensionData,
    ] = await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          username: true,
          displayName: true,
          email: true,
          phoneNumber: true,
          firstName: true,
          lastName: true,
          bio: true,
          twitter: true,
          instagram: true,
          avatarUrl: true,
          avatarThumb: true,
          interests: true,
          isPrivateAccount: true,
          isVisible: true,
          latitude: true,
          longitude: true,
          allowWaves: true,
          dmPrivacy: true,
          currentRoomId: true,
          hasCompletedOnboarding: true,
          invitedById: true,
          invitesRemaining: true,
          isPremium: true,
          premiumUntil: true,
          stripeCustomerId: true,
          stripeConnectAccountId: true,
          deletedAt: true,
          ageConfirmedAt: true,
          ...legalAcceptanceSelect,
          createdAt: true,
          updatedAt: true,
          lastSeenAt: true,
          followerCount: true,
          followingCount: true,
        },
      }),
      prisma.room.findMany({
        where: { hostId: userId },
        select: {
          id: true,
          title: true,
          description: true,
          topic: true,
          topics: true,
          isPrivate: true,
          roomType: true,
          createdAt: true,
          endedAt: true,
          canceledAt: true,
          scheduledFor: true,
          participantCount: true,
          totalAttendees: true,
          chatEnabled: true,
          chatVisibility: true,
          recordingEnabled: true,
          recordings: {
            select: {
              id: true,
              status: true,
              fileUrl: true,
              durationMs: true,
              startedAt: true,
              endedAt: true,
            },
          },
        },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.participant.findMany({
        where: { userId },
        select: {
          roomId: true,
          role: true,
          isMuted: true,
          isHidden: true,
          joinedAt: true,
          leftAt: true,
        },
        orderBy: { joinedAt: 'asc' },
      }),
      prisma.follow.findMany({
        where: { followingId: userId },
        select: { followerId: true, status: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.follow.findMany({
        where: { followerId: userId },
        select: { followingId: true, status: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.message.findMany({
        where: {
          roomId: null,
          OR: [{ senderId: userId }, { receiverId: userId }],
        },
        select: {
          id: true,
          kind: true,
          content: true,
          audioUrl: true,
          audioDurationMs: true,
          senderId: true,
          receiverId: true,
          isRead: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.message.findMany({
        where: { senderId: userId, roomId: { not: null } },
        select: {
          id: true,
          roomId: true,
          kind: true,
          content: true,
          audioUrl: true,
          audioDurationMs: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.roomChatMessage.findMany({
        where: { userId },
        select: {
          id: true,
          content: true,
          roomId: true,
          replyToId: true,
          isDeleted: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.conversationMember.findMany({
        where: { userId },
        select: {
          conversationId: true,
          joinedAt: true,
          lastReadAt: true,
          conversation: {
            select: {
              title: true,
              ownerId: true,
              createdAt: true,
              updatedAt: true,
            },
          },
        },
        orderBy: { joinedAt: 'asc' },
      }),
      prisma.groupMessage.findMany({
        where: {
          OR: [{ senderId: userId }, { conversation: { members: { some: { userId } } } }],
        },
        select: {
          id: true,
          conversationId: true,
          senderId: true,
          kind: true,
          content: true,
          audioUrl: true,
          audioDurationMs: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.roomRsvp.findMany({
        where: { userId },
        select: { roomId: true, reminder: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.pushToken.findMany({
        where: { userId },
        select: { platform: true, createdAt: true, lastUsed: true },
      }),
      prisma.notificationPreference.findUnique({ where: { userId } }),
      prisma.notification.findMany({
        where: { userId },
        select: {
          id: true,
          actorId: true,
          type: true,
          title: true,
          body: true,
          data: true,
          targetId: true,
          targetType: true,
          isRead: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.notification.findMany({
        where: { actorId: userId, userId: { not: userId } },
        select: {
          id: true,
          userId: true,
          type: true,
          targetId: true,
          targetType: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.roomHandRaise.findMany({
        where: { userId },
        select: { roomId: true, raisedAt: true },
        orderBy: { raisedAt: 'asc' },
      }),
      prisma.roomReaction.findMany({
        where: { userId },
        select: { roomId: true, emoji: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.block.findMany({
        where: { blockerId: userId },
        select: { blockedId: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.report.findMany({
        where: { reporterId: userId },
        select: {
          id: true,
          targetKind: true,
          reportedId: true,
          reportedRoomId: true,
          contentAuthorId: true,
          reportedMessageId: true,
          reportedGroupMessageId: true,
          reportedRoomMessageId: true,
          contentSnapshot: true,
          contentKind: true,
          contentCreatedAt: true,
          contentContextId: true,
          contentContextSnapshot: true,
          reason: true,
          details: true,
          resolvedAt: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.club.findMany({
        where: { ownerId: userId },
        select: {
          id: true,
          name: true,
          slug: true,
          description: true,
          rules: true,
          iconUrl: true,
          privacy: true,
          category: true,
          memberCount: true,
          isVerified: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.clubMember.findMany({
        where: { userId },
        select: {
          clubId: true,
          role: true,
          joinedAt: true,
          club: { select: { name: true, slug: true } },
        },
        orderBy: { joinedAt: 'asc' },
      }),
      prisma.tip.findMany({
        where: { fromUserId: userId },
        select: {
          id: true,
          toUserId: true,
          paymentIntentId: true,
          amount: true,
          currency: true,
          status: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.tip.findMany({
        where: { toUserId: userId },
        select: {
          id: true,
          fromUserId: true,
          paymentIntentId: true,
          amount: true,
          currency: true,
          status: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.subscription.findUnique({
        where: { userId },
        select: {
          stripeSubscriptionId: true,
          stripeCustomerId: true,
          status: true,
          currentPeriodEnd: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      prisma.profileView.findMany({
        where: { viewerId: userId },
        select: { viewedUserId: true, viewedAt: true },
        orderBy: { viewedAt: 'asc' },
      }),
      prisma.profileView.findMany({
        where: { viewedUserId: userId },
        select: { viewerId: true, viewedAt: true },
        orderBy: { viewedAt: 'asc' },
      }),
      prisma.roomBan.findMany({
        where: { bannedBy: userId },
        select: {
          roomId: true,
          userId: true,
          reason: true,
          expiresAt: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.roomBan.findMany({
        where: { userId },
        select: {
          roomId: true,
          bannedBy: true,
          reason: true,
          expiresAt: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.user.findMany({
        where: { invitedById: userId },
        select: { id: true, username: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.auditLog.findMany({
        where: { OR: [{ actorId: userId }, { targetUserId: userId }] },
        select: {
          action: true,
          targetUserId: true,
          targetRoomId: true,
          targetType: true,
          targetId: true,
          metadata: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.idempotencyKey.findMany({
        where: { userId },
        select: {
          scope: true,
          resourceId: true,
          createdAt: true,
          expiresAt: true,
        },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.mediaObject.findMany({
        where: { ownerId: userId },
        select: {
          id: true,
          kind: true,
          mimeType: true,
          sizeBytes: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'asc' },
      }),
      exportExtensionData(userId),
    ]);

    if (!profile) throw new AppError('USER_001');

    const { avatarUrl, avatarThumb, ...portableProfile } = profile;
    const portableHostedRooms = hostedRooms.map(({ recordings, ...room }) => ({
      ...room,
      recordings: recordings.map(({ fileUrl, ...recording }) => ({
        ...recording,
        fileMedia: mediaReferenceForExport(fileUrl, requestOrigin),
      })),
    }));
    const portableDirectMessages = directMessages.map(({ audioUrl, ...message }) => ({
      ...message,
      audioMedia: mediaReferenceForExport(audioUrl, requestOrigin),
    }));
    const portableLegacyRoomMessages = legacyRoomMessages.map(({ audioUrl, ...message }) => ({
      ...message,
      audioMedia: mediaReferenceForExport(audioUrl, requestOrigin),
    }));
    const portableGroupMessages = groupMessages.map(({ audioUrl, ...message }) => ({
      ...message,
      audioMedia: mediaReferenceForExport(audioUrl, requestOrigin),
    }));
    const portableOwnedClubs = ownedClubs.map(({ iconUrl, ...club }) => ({
      ...club,
      iconMedia: mediaReferenceForExport(iconUrl, requestOrigin),
    }));

    return {
      exportFormat: 'chathouse-user-export-v4',
      generatedAt: new Date().toISOString(),
      retention: {
        accountDeletionGraceDays: env.ACCOUNT_DELETION_GRACE_DAYS,
        auditLogRetentionDays: env.AUDIT_LOG_RETENTION_DAYS,
        mediaDownloadUrlTtlSeconds: env.MEDIA_EXPORT_URL_TTL_SECONDS,
        note: 'A deletion request disables the account immediately. Signing in during the grace period restores a self-deleted account; otherwise automated purge follows.',
      },
      profile: {
        ...portableProfile,
        avatarMedia: mediaReferenceForExport(avatarUrl, requestOrigin),
        avatarThumbnailMedia: mediaReferenceForExport(avatarThumb, requestOrigin),
      },
      hostedRooms: portableHostedRooms,
      participations,
      followers,
      following,
      directMessages: portableDirectMessages,
      legacyRoomMessages: portableLegacyRoomMessages,
      roomChatMessages,
      groupMemberships,
      groupMessages: portableGroupMessages,
      rsvps,
      notificationsReceived,
      notificationsTriggered,
      handRaises,
      reactions,
      blocksCreated,
      reportsFiled,
      ownedClubs: portableOwnedClubs,
      clubMemberships,
      payments: { tipsSent, tipsReceived, subscription },
      profileViews: { given: profileViewsGiven, received: profileViewsReceived },
      roomBans: { issued: roomBansIssued, received: roomBansReceived },
      invitedUsers,
      auditEvents,
      idempotentOperations,
      privateMedia: mediaObjects.map(media => ({
        ...media,
        downloadUrl: expiringMediaUrlFor(media.id, requestOrigin),
      })),
      pushTokens,
      notificationPreferences: notifPrefs,
      extensionData,
      intentionallyExcluded: [
        'password hashes',
        'access and refresh tokens',
        'password-reset and OTP secrets',
        'raw push-notification tokens',
        'private object-storage keys',
        'reports filed by other people',
      ],
    };
  },
};
