import { prisma } from '../../config/database';
import { AppError } from '../../middlewares/error.middleware';
import type {
  CompleteOnboardingInput,
  InterestsInput,
  LocationInput,
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

  async getById(id: string) {
    const user = await prisma.user.findUnique({ where: { id }, select: publicSelect });
    if (!user) throw new AppError('USER_001');
    return user;
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

  async search(input: SearchQueryInput) {
    const term = input.q.trim();
    return prisma.user.findMany({
      where: {
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
    const normalised = [...new Set(input.interests.map(i => i.trim().toLowerCase()))];
    return prisma.user.update({
      where: { id: userId },
      data: { interests: normalised },
      select: meSelect,
    });
  },

  async completeOnboarding(userId: string, input: CompleteOnboardingInput) {
    const data: Parameters<typeof prisma.user.update>[0]['data'] = {
      hasCompletedOnboarding: true,
    };
    if (input.displayName !== undefined) data.displayName = input.displayName;
    if (input.bio !== undefined) data.bio = input.bio;
    if (input.avatarUrl !== undefined) data.avatarUrl = input.avatarUrl;
    if (input.interests !== undefined) {
      data.interests = [...new Set(input.interests.map(i => i.trim().toLowerCase()))];
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
    const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000);
    return prisma.user.findMany({
      where: {
        isVisible: true,
        isOnline: true,
        NOT: { id: viewerId },
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
      },
      take: 200,
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
      permanentDeletionAt: new Date(deletedAt.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString(),
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

  async updateNotificationPreferences(userId: string, input: Record<string, boolean>) {
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
