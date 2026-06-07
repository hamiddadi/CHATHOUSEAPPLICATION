import type { Prisma } from '@prisma/client';
import { prisma } from '../../config/database';
import { AppError } from '../../middlewares/error.middleware';
import { getBlockedIdSet } from '../social/blocks';
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
  latitude: true,
  longitude: true,
  lastSeenAt: true,
  interests: true,
  hasCompletedOnboarding: true,
  deletedAt: true,
} as const;

// Only surface users seen within this window on the live map.
const ONLINE_WINDOW_MS = 30 * 60 * 1000;
// Grace period between a deletion request and the permanent purge.
const DELETION_GRACE_MS = 30 * 24 * 60 * 60 * 1000;
// Hard caps on how many pins a single map query materialises.
const ONLINE_MAP_LIMIT = 200;
const FOLLOWING_MAP_LIMIT = 500;

// Canonical interest list: trimmed, lowercased, de-duplicated.
const normaliseInterests = (xs: string[]): string[] => [
  ...new Set(xs.map(i => i.trim().toLowerCase())),
];

export const usersService = {
  async getMe(userId: string) {
    const me = await prisma.user.findUnique({ where: { id: userId }, select: meSelect });
    if (!me) throw new AppError('USER_001');
    return me;
  },

  async updateMe(userId: string, input: UpdateMeInput) {
    return prisma.user.update({ where: { id: userId }, data: input, select: meSelect });
  },

  async setVisibility(userId: string, input: VisibilityInput) {
    return prisma.user.update({
      where: { id: userId },
      data: { isVisible: input.isVisible },
      select: { id: true, isVisible: true },
    });
  },

  async setLocation(userId: string, input: LocationInput) {
    return prisma.user.update({
      where: { id: userId },
      data: {
        latitude: input.latitude,
        longitude: input.longitude,
        lastSeenAt: new Date(),
      },
      select: { id: true, latitude: true, longitude: true, lastSeenAt: true },
    });
  },

  async getById(id: string, viewerId?: string) {
    // A block is a symmetric break: a blocked user's profile must not be
    // readable by the other party. Also hide soft-deleted accounts.
    if (viewerId && viewerId !== id) {
      const blocked = await getBlockedIdSet(viewerId);
      if (blocked.has(id)) throw new AppError('USER_001');
    }
    const user = await prisma.user.findFirst({
      where: { id, deletedAt: null },
      // Inline the inviter relation here (not in the shared publicSelect) so
      // the "Nominated by @inviter" line rides on the detail payload without
      // adding a join to every search-result row.
      select: {
        ...publicSelect,
        invitedBy: { select: { id: true, username: true, displayName: true } },
      },
    });
    if (!user) throw new AppError('USER_001');

    // Per-viewer relationship flag so the client can render Follow/Following
    // without a second round-trip. Cheap indexed lookup on the unique pair.
    let isFollowedByMe = false;
    if (viewerId && viewerId !== id) {
      const rel = await prisma.follow.findUnique({
        where: { followerId_followingId: { followerId: viewerId, followingId: id } },
        select: { followerId: true },
      });
      isFollowedByMe = rel !== null;
    }
    return { ...user, isFollowedByMe };
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
    if (input.avatarUrl !== undefined) data.avatarUrl = input.avatarUrl;
    if (input.interests !== undefined) {
      data.interests = normaliseInterests(input.interests);
    }
    return prisma.user.update({
      where: { id: userId },
      data,
      select: meSelect,
    });
  },

  async getOnlineLocations(viewerId: string, opts: { radiusKm?: number } = {}) {
    // Exclude ghost-mode users and the viewer themself. Only users with
    // recorded coordinates and seen in the last 30 min are surfaced.
    // CRITICAL: also exclude blocked/blocking users — the map is the most
    // sensitive surface (precise GPS), so a blocked harasser must never be
    // able to locate (or be located by) the viewer. And hide soft-deleted.
    const thirtyMinAgo = new Date(Date.now() - ONLINE_WINDOW_MS);
    const blocked = await getBlockedIdSet(viewerId);

    // "Nearby" filter: when a radius is requested, restrict the result to a
    // lat/long bounding box centred on the viewer's OWN last known location.
    // A bounding box (not a precise haversine distance) keeps the query
    // index-friendly on the (latitude, longitude) columns. If the viewer has
    // no recorded location we can't compute a centre, so we fall back to the
    // global online set (still capped) rather than returning an empty map.
    let geoBounds:
      | { latitude: { gte: number; lte: number }; longitude: { gte: number; lte: number } }
      | undefined;
    if (opts.radiusKm && opts.radiusKm > 0) {
      const me = await prisma.user.findUnique({
        where: { id: viewerId },
        select: { latitude: true, longitude: true },
      });
      if (me?.latitude != null && me?.longitude != null) {
        // ~111.045 km per degree of latitude; longitude degrees shrink toward
        // the poles by cos(latitude). Clamp cos so we never divide by ~0.
        const latDelta = opts.radiusKm / 111.045;
        const cosLat = Math.max(Math.abs(Math.cos((me.latitude * Math.PI) / 180)), 1e-6);
        const lonDelta = opts.radiusKm / (111.045 * cosLat);
        geoBounds = {
          latitude: { gte: me.latitude - latDelta, lte: me.latitude + latDelta },
          longitude: { gte: me.longitude - lonDelta, lte: me.longitude + lonDelta },
        };
      }
    }

    return prisma.user.findMany({
      where: {
        isVisible: true,
        isOnline: true,
        deletedAt: null,
        id: { notIn: [viewerId, ...blocked] },
        // A gte/lte range already excludes nulls; the `not: null` guard only
        // applies on the global (no-radius) path.
        latitude: geoBounds ? geoBounds.latitude : { not: null },
        longitude: geoBounds ? geoBounds.longitude : { not: null },
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
      take: ONLINE_MAP_LIMIT,
    });
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
      where: { followerId: viewerId },
      select: { followingId: true },
    });
    const ids = follows.map(f => f.followingId).filter(id => !blocked.has(id));
    if (ids.length === 0) return [];
    return prisma.user.findMany({
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
  },

  // ─── Account Deletion (30-day soft delete) ─────────────
  async requestDeletion(userId: string) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new AppError('USER_001');
    if (user.deletedAt) throw new AppError('ACCOUNT_001');

    const deletedAt = new Date();
    await prisma.user.update({
      where: { id: userId },
      data: { deletedAt },
    });
    return {
      deletedAt: deletedAt.toISOString(),
      permanentDeletionAt: new Date(deletedAt.getTime() + DELETION_GRACE_MS).toISOString(),
    };
  },

  async cancelDeletion(userId: string) {
    await prisma.user.update({
      where: { id: userId },
      data: { deletedAt: null },
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
   * GDPR Article 20 — right to portability. Returns every piece of
   * user-owned data we know about, in a structured JSON archive. We
   * deliberately denormalize so the user can read it without joining
   * tables: profile, hosted rooms, participations, follows, DMs sent,
   * room chat sent, RSVPs, push tokens, notification preferences.
   *
   * NOT included on purpose: AuditLog actions targeting the user (those
   * belong to the moderation trail), Reports filed against the user
   * (legitimate-interest exception), other users' content.
   */
  async exportData(userId: string) {
    const [
      profile,
      hostedRooms,
      participations,
      followers,
      following,
      sentMessages,
      sentRoomMessages,
      rsvps,
      pushTokens,
      notifPrefs,
      handRaises,
      blocksCreated,
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
          interests: true,
          isPrivateAccount: true,
          isVisible: true,
          allowWaves: true,
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
          scheduledFor: true,
          participantCount: true,
        },
      }),
      prisma.participant.findMany({
        where: { userId },
        select: { roomId: true, role: true, joinedAt: true, leftAt: true },
      }),
      prisma.follow.findMany({
        where: { followingId: userId },
        select: { followerId: true, createdAt: true },
      }),
      prisma.follow.findMany({
        where: { followerId: userId },
        select: { followingId: true, createdAt: true },
      }),
      prisma.message.findMany({
        where: { senderId: userId },
        select: { id: true, content: true, receiverId: true, roomId: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 5000,
      }),
      prisma.roomChatMessage.findMany({
        where: { userId },
        select: { id: true, content: true, roomId: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 5000,
      }),
      prisma.roomRsvp.findMany({
        where: { userId },
        select: { roomId: true, reminder: true, createdAt: true },
      }),
      prisma.pushToken.findMany({
        where: { userId },
        select: { platform: true, createdAt: true, lastUsed: true },
      }),
      prisma.notificationPreference.findUnique({ where: { userId } }),
      prisma.roomHandRaise.findMany({
        where: { userId },
        select: { roomId: true, raisedAt: true },
      }),
      prisma.block.findMany({
        where: { blockerId: userId },
        select: { blockedId: true, createdAt: true },
      }),
    ]);

    if (!profile) throw new AppError('USER_001');

    return {
      exportFormat: 'chathouse-user-export-v1',
      generatedAt: new Date().toISOString(),
      retentionNote:
        "Vos données sont conservées pendant la durée d'utilisation du service. La suppression de compte purge l'ensemble après 30 jours.",
      profile,
      hostedRooms,
      participations,
      followers,
      following,
      sentDirectMessages: sentMessages.filter(m => !m.roomId),
      sentRoomMessages,
      rsvps,
      handRaises,
      blocksCreated,
      pushTokens,
      notificationPreferences: notifPrefs,
    };
  },
};
