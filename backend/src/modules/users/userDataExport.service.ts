import { prisma } from '../../config/database';
import { env } from '../../config/env';
import { AppError } from '../../middlewares/error.middleware';
import { exportExtensionData } from '../../extensions/gdpr';
import { expiringMediaUrlFor } from '../media/media-url';
import { legalAcceptanceSelect } from '../auth/legal-acceptance';

export const USER_EXPORT_BATCH_SIZE = 250;

type ExportMediaReference = { mediaId: string; downloadUrl: string } | { externalUrl: string };

const mediaIdFromInternalUrl = (value: string): string | null => {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  if (env.PUBLIC_URL && parsed.origin !== new URL(env.PUBLIC_URL).origin) return null;
  const parts = parsed.pathname.split('/').filter(Boolean);
  const stable = parts.length === 3;
  const expiring = parts.length === 4 && /^\d{10}$/.test(parts[2] ?? '');
  const mediaId = parts[1];
  if (parts[0] !== 'media' || (!stable && !expiring) || !mediaId || !parts.at(-1)) return null;
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
  return mediaId
    ? { mediaId, downloadUrl: expiringMediaUrlFor(mediaId, requestOrigin) }
    : { externalUrl: value };
};

const json = (value: unknown): string => JSON.stringify(value) ?? 'null';
const identity = <T>(value: T): T => value;
const withoutCursorId = <Row extends { id: string }>(row: Row): Omit<Row, 'id'> => {
  const { id: _id, ...portable } = row;
  return portable;
};

/**
 * Streams one JSON array while retaining at most one database page. The
 * loader must return rows in ascending id order and apply `afterId` as a
 * strict lower bound. Exported for a focused >5000-row bounded-memory test.
 */
export const streamJsonArrayInBatches = async function* <Row extends { id: string }, Out>(
  loadPage: (afterId?: string) => Promise<readonly Row[]>,
  transform: (row: Row) => Out,
): AsyncGenerator<string> {
  yield '[';
  let afterId: string | undefined;
  let first = true;
  for (;;) {
    const rows = await loadPage(afterId);
    if (rows.length === 0) break;
    for (const row of rows) {
      yield `${first ? '' : ','}${json(transform(row))}`;
      first = false;
    }
    const last = rows.at(-1);
    if (!last || rows.length < USER_EXPORT_BATCH_SIZE) break;
    if (last.id === afterId) throw new Error('GDPR export cursor did not advance');
    afterId = last.id;
  }
  yield ']';
};

const exportProfile = (userId: string) =>
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
  });

type ExportProfile = NonNullable<Awaited<ReturnType<typeof exportProfile>>>;

const archiveChunks = async function* (
  userId: string,
  requestOrigin: string,
  profile: ExportProfile,
  generatedAt: string,
): AsyncGenerator<string> {
  const { avatarUrl, avatarThumb, ...portableProfile } = profile;
  const prefix = (name: string): string => `,${json(name)}:`;
  const after = (afterId?: string): { id: { gt: string } } | object =>
    afterId ? { id: { gt: afterId } } : {};

  yield `{${json('exportFormat')}:${json('chathouse-user-export-v4')}`;
  yield `${prefix('generatedAt')}${json(generatedAt)}`;
  yield `${prefix('retention')}${json({
    accountDeletionGraceDays: env.ACCOUNT_DELETION_GRACE_DAYS,
    auditLogRetentionDays: env.AUDIT_LOG_RETENTION_DAYS,
    mediaDownloadUrlTtlSeconds: env.MEDIA_EXPORT_URL_TTL_SECONDS,
    note: 'A deletion request disables the account immediately. Signing in during the grace period restores a self-deleted account; otherwise automated purge follows.',
  })}`;
  yield `${prefix('profile')}${json({
    ...portableProfile,
    avatarMedia: mediaReferenceForExport(avatarUrl, requestOrigin),
    avatarThumbnailMedia: mediaReferenceForExport(avatarThumb, requestOrigin),
  })}`;

  yield prefix('hostedRooms');
  yield* streamJsonArrayInBatches(
    afterId =>
      prisma.room.findMany({
        where: { hostId: userId, ...after(afterId) },
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
        orderBy: { id: 'asc' },
        take: USER_EXPORT_BATCH_SIZE,
      }),
    row => {
      const { recordings, ...room } = row;
      return {
        ...room,
        recordings: recordings.map(({ fileUrl, ...recording }) => ({
          ...recording,
          fileMedia: mediaReferenceForExport(fileUrl, requestOrigin),
        })),
      };
    },
  );

  yield prefix('participations');
  yield* streamJsonArrayInBatches(
    afterId =>
      prisma.participant.findMany({
        where: { userId, ...after(afterId) },
        select: {
          id: true,
          roomId: true,
          role: true,
          isMuted: true,
          isHidden: true,
          joinedAt: true,
          leftAt: true,
        },
        orderBy: { id: 'asc' },
        take: USER_EXPORT_BATCH_SIZE,
      }),
    withoutCursorId,
  );

  yield prefix('followers');
  yield* streamJsonArrayInBatches(
    afterId =>
      prisma.follow.findMany({
        where: { followingId: userId, ...after(afterId) },
        select: { id: true, followerId: true, status: true, createdAt: true },
        orderBy: { id: 'asc' },
        take: USER_EXPORT_BATCH_SIZE,
      }),
    withoutCursorId,
  );

  yield prefix('following');
  yield* streamJsonArrayInBatches(
    afterId =>
      prisma.follow.findMany({
        where: { followerId: userId, ...after(afterId) },
        select: { id: true, followingId: true, status: true, createdAt: true },
        orderBy: { id: 'asc' },
        take: USER_EXPORT_BATCH_SIZE,
      }),
    withoutCursorId,
  );

  yield prefix('directMessages');
  yield* streamJsonArrayInBatches(
    afterId =>
      prisma.message.findMany({
        where: {
          roomId: null,
          OR: [{ senderId: userId }, { receiverId: userId }],
          ...after(afterId),
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
        orderBy: { id: 'asc' },
        take: USER_EXPORT_BATCH_SIZE,
      }),
    row => {
      const { audioUrl, ...message } = row;
      return { ...message, audioMedia: mediaReferenceForExport(audioUrl, requestOrigin) };
    },
  );

  yield prefix('legacyRoomMessages');
  yield* streamJsonArrayInBatches(
    afterId =>
      prisma.message.findMany({
        where: { senderId: userId, roomId: { not: null }, ...after(afterId) },
        select: {
          id: true,
          roomId: true,
          kind: true,
          content: true,
          audioUrl: true,
          audioDurationMs: true,
          createdAt: true,
        },
        orderBy: { id: 'asc' },
        take: USER_EXPORT_BATCH_SIZE,
      }),
    row => {
      const { audioUrl, ...message } = row;
      return { ...message, audioMedia: mediaReferenceForExport(audioUrl, requestOrigin) };
    },
  );

  yield prefix('roomChatMessages');
  yield* streamJsonArrayInBatches(
    afterId =>
      prisma.roomChatMessage.findMany({
        where: { userId, ...after(afterId) },
        select: {
          id: true,
          content: true,
          roomId: true,
          replyToId: true,
          isDeleted: true,
          createdAt: true,
        },
        orderBy: { id: 'asc' },
        take: USER_EXPORT_BATCH_SIZE,
      }),
    identity,
  );

  yield prefix('groupMemberships');
  yield* streamJsonArrayInBatches(
    afterId =>
      prisma.conversationMember.findMany({
        where: { userId, ...after(afterId) },
        select: {
          id: true,
          conversationId: true,
          joinedAt: true,
          lastReadAt: true,
          conversation: {
            select: { title: true, ownerId: true, createdAt: true, updatedAt: true },
          },
        },
        orderBy: { id: 'asc' },
        take: USER_EXPORT_BATCH_SIZE,
      }),
    withoutCursorId,
  );

  yield prefix('groupMessages');
  yield* streamJsonArrayInBatches(
    afterId =>
      prisma.groupMessage.findMany({
        where: {
          OR: [{ senderId: userId }, { conversation: { members: { some: { userId } } } }],
          ...after(afterId),
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
        orderBy: { id: 'asc' },
        take: USER_EXPORT_BATCH_SIZE,
      }),
    row => {
      const { audioUrl, ...message } = row;
      return { ...message, audioMedia: mediaReferenceForExport(audioUrl, requestOrigin) };
    },
  );

  yield prefix('rsvps');
  yield* streamJsonArrayInBatches(
    afterId =>
      prisma.roomRsvp.findMany({
        where: { userId, ...after(afterId) },
        select: { id: true, roomId: true, reminder: true, createdAt: true },
        orderBy: { id: 'asc' },
        take: USER_EXPORT_BATCH_SIZE,
      }),
    withoutCursorId,
  );

  yield prefix('notificationsReceived');
  yield* streamJsonArrayInBatches(
    afterId =>
      prisma.notification.findMany({
        where: { userId, ...after(afterId) },
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
        orderBy: { id: 'asc' },
        take: USER_EXPORT_BATCH_SIZE,
      }),
    identity,
  );

  yield prefix('notificationsTriggered');
  yield* streamJsonArrayInBatches(
    afterId =>
      prisma.notification.findMany({
        where: { actorId: userId, userId: { not: userId }, ...after(afterId) },
        select: {
          id: true,
          userId: true,
          type: true,
          targetId: true,
          targetType: true,
          createdAt: true,
        },
        orderBy: { id: 'asc' },
        take: USER_EXPORT_BATCH_SIZE,
      }),
    identity,
  );

  yield prefix('handRaises');
  yield* streamJsonArrayInBatches(
    afterId =>
      prisma.roomHandRaise.findMany({
        where: { userId, ...after(afterId) },
        select: { id: true, roomId: true, raisedAt: true },
        orderBy: { id: 'asc' },
        take: USER_EXPORT_BATCH_SIZE,
      }),
    withoutCursorId,
  );

  yield prefix('reactions');
  yield* streamJsonArrayInBatches(
    afterId =>
      prisma.roomReaction.findMany({
        where: { userId, ...after(afterId) },
        select: { id: true, roomId: true, emoji: true, createdAt: true },
        orderBy: { id: 'asc' },
        take: USER_EXPORT_BATCH_SIZE,
      }),
    withoutCursorId,
  );

  yield prefix('blocksCreated');
  yield* streamJsonArrayInBatches(
    afterId =>
      prisma.block.findMany({
        where: { blockerId: userId, ...after(afterId) },
        select: { id: true, blockedId: true, createdAt: true },
        orderBy: { id: 'asc' },
        take: USER_EXPORT_BATCH_SIZE,
      }),
    withoutCursorId,
  );

  yield prefix('reportsFiled');
  yield* streamJsonArrayInBatches(
    afterId =>
      prisma.report.findMany({
        where: { reporterId: userId, ...after(afterId) },
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
        orderBy: { id: 'asc' },
        take: USER_EXPORT_BATCH_SIZE,
      }),
    identity,
  );

  yield prefix('ownedClubs');
  yield* streamJsonArrayInBatches(
    afterId =>
      prisma.club.findMany({
        where: { ownerId: userId, ...after(afterId) },
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
        orderBy: { id: 'asc' },
        take: USER_EXPORT_BATCH_SIZE,
      }),
    row => {
      const { iconUrl, ...club } = row;
      return { ...club, iconMedia: mediaReferenceForExport(iconUrl, requestOrigin) };
    },
  );

  yield prefix('clubMemberships');
  yield* streamJsonArrayInBatches(
    afterId =>
      prisma.clubMember.findMany({
        where: { userId, ...after(afterId) },
        select: {
          id: true,
          clubId: true,
          role: true,
          joinedAt: true,
          club: { select: { name: true, slug: true } },
        },
        orderBy: { id: 'asc' },
        take: USER_EXPORT_BATCH_SIZE,
      }),
    withoutCursorId,
  );

  yield `${prefix('payments')}{${json('tipsSent')}:`;
  yield* streamJsonArrayInBatches(
    afterId =>
      prisma.tip.findMany({
        where: { fromUserId: userId, ...after(afterId) },
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
        orderBy: { id: 'asc' },
        take: USER_EXPORT_BATCH_SIZE,
      }),
    identity,
  );
  yield `,${json('tipsReceived')}:`;
  yield* streamJsonArrayInBatches(
    afterId =>
      prisma.tip.findMany({
        where: { toUserId: userId, ...after(afterId) },
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
        orderBy: { id: 'asc' },
        take: USER_EXPORT_BATCH_SIZE,
      }),
    identity,
  );
  const subscription = await prisma.subscription.findUnique({
    where: { userId },
    select: {
      stripeSubscriptionId: true,
      stripeCustomerId: true,
      status: true,
      currentPeriodEnd: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  yield `,${json('subscription')}:${json(subscription)}}`;

  yield `${prefix('profileViews')}{${json('given')}:`;
  yield* streamJsonArrayInBatches(
    afterId =>
      prisma.profileView.findMany({
        where: { viewerId: userId, ...after(afterId) },
        select: { id: true, viewedUserId: true, viewedAt: true },
        orderBy: { id: 'asc' },
        take: USER_EXPORT_BATCH_SIZE,
      }),
    withoutCursorId,
  );
  yield `,${json('received')}:`;
  yield* streamJsonArrayInBatches(
    afterId =>
      prisma.profileView.findMany({
        where: { viewedUserId: userId, ...after(afterId) },
        select: { id: true, viewerId: true, viewedAt: true },
        orderBy: { id: 'asc' },
        take: USER_EXPORT_BATCH_SIZE,
      }),
    withoutCursorId,
  );
  yield '}';

  yield `${prefix('roomBans')}{${json('issued')}:`;
  yield* streamJsonArrayInBatches(
    afterId =>
      prisma.roomBan.findMany({
        where: { bannedBy: userId, ...after(afterId) },
        select: {
          id: true,
          roomId: true,
          userId: true,
          reason: true,
          expiresAt: true,
          createdAt: true,
        },
        orderBy: { id: 'asc' },
        take: USER_EXPORT_BATCH_SIZE,
      }),
    withoutCursorId,
  );
  yield `,${json('received')}:`;
  yield* streamJsonArrayInBatches(
    afterId =>
      prisma.roomBan.findMany({
        where: { userId, ...after(afterId) },
        select: {
          id: true,
          roomId: true,
          bannedBy: true,
          reason: true,
          expiresAt: true,
          createdAt: true,
        },
        orderBy: { id: 'asc' },
        take: USER_EXPORT_BATCH_SIZE,
      }),
    withoutCursorId,
  );
  yield '}';

  yield prefix('invitedUsers');
  yield* streamJsonArrayInBatches(
    afterId =>
      prisma.user.findMany({
        where: { invitedById: userId, ...after(afterId) },
        select: { id: true, username: true, createdAt: true },
        orderBy: { id: 'asc' },
        take: USER_EXPORT_BATCH_SIZE,
      }),
    identity,
  );

  yield prefix('auditEvents');
  yield* streamJsonArrayInBatches(
    afterId =>
      prisma.auditLog.findMany({
        where: {
          OR: [{ actorId: userId }, { targetUserId: userId }],
          ...after(afterId),
        },
        select: {
          id: true,
          action: true,
          targetUserId: true,
          targetRoomId: true,
          targetType: true,
          targetId: true,
          metadata: true,
          createdAt: true,
        },
        orderBy: { id: 'asc' },
        take: USER_EXPORT_BATCH_SIZE,
      }),
    withoutCursorId,
  );

  yield prefix('idempotentOperations');
  yield* streamJsonArrayInBatches(
    afterId =>
      prisma.idempotencyKey.findMany({
        where: { userId, ...after(afterId) },
        select: { id: true, scope: true, resourceId: true, createdAt: true, expiresAt: true },
        orderBy: { id: 'asc' },
        take: USER_EXPORT_BATCH_SIZE,
      }),
    withoutCursorId,
  );

  yield prefix('privateMedia');
  yield* streamJsonArrayInBatches(
    afterId =>
      prisma.mediaObject.findMany({
        where: { ownerId: userId, ...after(afterId) },
        select: { id: true, kind: true, mimeType: true, sizeBytes: true, createdAt: true },
        orderBy: { id: 'asc' },
        take: USER_EXPORT_BATCH_SIZE,
      }),
    media => ({ ...media, downloadUrl: expiringMediaUrlFor(media.id, requestOrigin) }),
  );

  yield prefix('pushTokens');
  yield* streamJsonArrayInBatches(
    afterId =>
      prisma.pushToken.findMany({
        where: { userId, ...after(afterId) },
        select: { id: true, platform: true, createdAt: true, lastUsed: true },
        orderBy: { id: 'asc' },
        take: USER_EXPORT_BATCH_SIZE,
      }),
    withoutCursorId,
  );

  const notificationPreferences = await prisma.notificationPreference.findUnique({
    where: { userId },
  });
  yield `${prefix('notificationPreferences')}${json(notificationPreferences)}`;
  yield `${prefix('extensionData')}${json(await exportExtensionData(userId))}`;
  yield `${prefix('intentionallyExcluded')}${json([
    'password hashes',
    'access and refresh tokens',
    'password-reset and OTP secrets',
    'raw push-notification tokens',
    'private object-storage keys',
    'reports filed by other people',
  ])}}`;
};

/**
 * Performs the only pre-stream validation (profile ownership/existence), then
 * returns a compact JSON archive generator. The public HTTP schema is
 * unchanged; only transfer framing becomes chunked.
 */
export const createUserDataExportStream = async (
  userId: string,
  requestOrigin: string,
): Promise<AsyncGenerator<string>> => {
  const profile = await exportProfile(userId);
  if (!profile) throw new AppError('USER_001');
  return archiveChunks(userId, requestOrigin, profile, new Date().toISOString());
};
