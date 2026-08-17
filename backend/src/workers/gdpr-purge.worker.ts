import { Worker } from 'bullmq';
import { Prisma } from '@prisma/client';
import { logger } from '../config/logger';
import { prisma, runWriteWithRetry } from '../config/database';
import { env } from '../config/env';
import { bullConnection } from '../queues/connection';
import {
  scheduleStripeCancellation,
  teardownStripeForUser,
} from '../extensions/modules/payments/stripe.gdpr';
import { purgeExtensionDataForUser } from '../extensions/gdpr';
import { clubExtensionCleanupOutboxData } from '../extensions/club-extension-cleanup.outbox';
import { mediaDeletionOutboxData } from '../modules/media/media-deletion.outbox';
import {
  GDPR_PURGE_JOB_NAME,
  GDPR_PURGE_QUEUE_NAME,
  closeGdprPurgeQueue,
  getGdprPurgeQueue,
} from './gdpr-purge.queue';

/**
 * GDPR data-purge worker.
 *
 * Runs once a day (default 03:00, configurable via GDPR_PURGE_CRON) and applies
 * the retention policy documented in `docs/rgpd/data-retention-policy.md`:
 *
 *   (a) Hard-delete soft-deleted user accounts past the grace window.
 *   (b) Delete revoked / expired refresh tokens.
 *   (c) Delete spent / expired OTP codes.
 *   (d) Delete expired password-reset tokens.
 *   (e) Delete audit logs past their retention window.
 *
 * Each step is wrapped in its own try/catch so a single failing step never
 * aborts the rest of the purge, and every step logs the number of rows it
 * removed. Follows the canonical BullMQ pattern used by the existing
 * `src/queues/*` modules (lazy singletons, repeatable cron cleared on boot to
 * avoid double-fire across redeploys, `failed` handler, explicit shutdown).
 *
 * QUEUE_NAME and the queue accessor live in `gdpr-purge.queue.ts` (single
 * source of truth) and are imported here.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

// Parsed centrally by env.ts so the worker, account-status API and production
// deployment all use the same validated value.
const PURGE_CRON = env.GDPR_PURGE_CRON;

let worker: Worker | null = null;

interface OwnedMediaForPurge {
  id: string;
  storageKey: string;
  kind: string;
  uploadCompletedAt: Date | null;
  deletionClaimedAt: Date | null;
}

/**
 * Resolve every authoritative club-media reference before deleting its
 * uploader. Club icons/covers are neutralized atomically; ownership is not
 * transferred because the immutable storage key still embeds the erased user
 * id and no durable object re-key operation exists.
 *
 * The returned rows remain owned by the victim and are therefore safe to put
 * in the deletion outbox immediately before the User DELETE in this same
 * transaction.
 */
const prepareOwnedMediaForPurge = async (
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<OwnedMediaForPurge[]> => {
  let ownedMedia = await tx.$queryRaw<OwnedMediaForPurge[]>(Prisma.sql`
    SELECT "id", "storageKey", "kind", "uploadCompletedAt", "deletionClaimedAt"
    FROM "MediaObject"
    WHERE "ownerId" = ${userId}
    ORDER BY "id"
  `);
  if (ownedMedia.length === 0) {
    // Legacy evidence may retain only the authoritative author id and URL.
    // It still must lose the playable capability when the author is purged.
    await tx.report.updateMany({
      where: { contentAuthorId: userId },
      data: { contentMediaObjectId: null, contentAudioUrl: null },
    });
    return [];
  }

  let byId = new Map(ownedMedia.map(media => [media.id, media]));
  const mediaIds = [...byId.keys()];
  let mediaLocked = false;
  const lockAndRefreshOwnedMedia = async (): Promise<void> => {
    if (mediaLocked) return;
    ownedMedia = await tx.$queryRaw<OwnedMediaForPurge[]>(Prisma.sql`
      SELECT "id", "storageKey", "kind", "uploadCompletedAt", "deletionClaimedAt"
      FROM "MediaObject"
      WHERE "ownerId" = ${userId}
        AND "id" IN (${Prisma.join(mediaIds)})
      ORDER BY "id"
      FOR UPDATE
    `);
    byId = new Map(ownedMedia.map(media => [media.id, media]));
    mediaLocked = true;
  };
  const linkedCoverClubIds = await tx.clubMetadata.findMany({
    where: { coverMediaObjectId: { in: mediaIds } },
    select: { clubId: true },
  });
  const linkedIconClubIds = await tx.club.findMany({
    where: { iconMediaObjectId: { in: mediaIds } },
    select: { id: true },
  });

  const candidateClubIds = [
    ...new Set([
      ...linkedCoverClubIds.map(row => row.clubId),
      ...linkedIconClubIds.map(row => row.id),
    ]),
  ].sort();
  if (candidateClubIds.length > 0) {
    // setCover/club update lock club -> media. The victim User row is already
    // locked by the caller; take the same remaining order so no writer can
    // replace a reference between our validation and its neutralization.
    await tx.$queryRaw(Prisma.sql`
      SELECT c."id"
      FROM "Club" AS c
      WHERE c."id" IN (${Prisma.join(candidateClubIds)})
      ORDER BY c."id"
      FOR UPDATE OF c
    `);
    await tx.$queryRaw(Prisma.sql`
      SELECT "clubId"
      FROM "ClubMetadata"
      WHERE "clubId" IN (${Prisma.join(candidateClubIds)})
      ORDER BY "clubId"
      FOR UPDATE
    `);
    await lockAndRefreshOwnedMedia();

    const currentCovers = await tx.clubMetadata.findMany({
      where: { clubId: { in: candidateClubIds } },
      select: { clubId: true, coverMediaObjectId: true },
    });
    for (const cover of currentCovers) {
      if (cover.coverMediaObjectId && byId.has(cover.coverMediaObjectId)) {
        await tx.clubMetadata.update({
          where: { clubId: cover.clubId },
          data: { coverMediaObjectId: null, coverUrl: null },
        });
      }
    }

    const currentIcons = await tx.club.findMany({
      where: { id: { in: candidateClubIds } },
      select: { id: true, iconMediaObjectId: true },
    });
    for (const icon of currentIcons) {
      if (icon.iconMediaObjectId && byId.has(icon.iconMediaObjectId)) {
        await tx.club.update({
          where: { id: icon.id },
          data: { iconMediaObjectId: null, iconUrl: null },
        });
      }
    }
  }

  await lockAndRefreshOwnedMedia();

  const mediaStillOwned = await tx.mediaObject.findMany({
    where: { ownerId: userId },
    select: { id: true },
  });
  // Moderation keeps immutable ids/text snapshots but the retention policy
  // does not grant an indefinite exception for private voice bytes. Clear the
  // playable reference by authoritative author id as well as by FK, covering
  // legacy rows whose media cutover link was never populated.
  await tx.report.updateMany({
    where: {
      OR: [
        { contentAuthorId: userId },
        ...(mediaStillOwned.length > 0
          ? [{ contentMediaObjectId: { in: mediaStillOwned.map(media => media.id) } }]
          : []),
      ],
    },
    data: { contentMediaObjectId: null, contentAudioUrl: null },
  });

  return tx.mediaObject.findMany({
    where: { ownerId: userId },
    select: {
      id: true,
      storageKey: true,
      kind: true,
      uploadCompletedAt: true,
      deletionClaimedAt: true,
    },
    orderBy: { id: 'asc' },
  });
};

/**
 * Hard-delete one user without leaving denormalized counters or owner FKs in
 * an invalid state. Conversation and club ownership prefer an active member,
 * then fall back to a soft-deleted member that still owns data during their
 * grace period. Empty containers are deleted. Everything commits atomically.
 */
export const hardDeleteUserWithRelationalRepair = async (
  userId: string,
  promotedClubMetadataIds: readonly string[] = [],
): Promise<boolean> =>
  runWriteWithRetry(() =>
    prisma.$transaction(
      async tx => {
        const locked = await tx.$queryRaw<{ id: string }[]>`
          SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
        if (locked.length === 0) return false;

        const ownedConversations = await tx.conversation.findMany({
          where: { ownerId: userId },
          select: { id: true },
          orderBy: { id: 'asc' },
        });
        for (const conversation of ownedConversations) {
          const lockedConversation = await tx.$queryRaw<{ ownerId: string }[]>`
            SELECT "ownerId" FROM "Conversation" WHERE "id" = ${conversation.id} FOR UPDATE`;
          if (lockedConversation[0]?.ownerId !== userId) continue;
          const [successor] = await tx.$queryRaw<{ userId: string }[]>`
            SELECT cm."userId"
            FROM "ConversationMember" AS cm
            JOIN "User" AS u ON u."id" = cm."userId"
            WHERE cm."conversationId" = ${conversation.id}
              AND cm."userId" <> ${userId}
            ORDER BY
              CASE WHEN u."deletedAt" IS NULL THEN 0 ELSE 1 END,
              cm."joinedAt" ASC,
              cm."id" ASC
            LIMIT 1
            FOR UPDATE OF cm, u
          `;
          if (successor) {
            await tx.conversation.update({
              where: { id: conversation.id },
              data: { ownerId: successor.userId },
            });
          } else {
            await tx.conversation.delete({ where: { id: conversation.id } });
          }
        }

        const deletedClubIds: string[] = [];
        const ownedClubs = await tx.club.findMany({
          where: { ownerId: userId },
          select: { id: true },
          orderBy: { id: 'asc' },
        });
        for (const club of ownedClubs) {
          const lockedClub = await tx.$queryRaw<{ ownerId: string }[]>`
            SELECT "ownerId" FROM "Club" WHERE "id" = ${club.id} FOR UPDATE`;
          if (lockedClub[0]?.ownerId !== userId) continue;

          const [successor] = await tx.$queryRaw<{ userId: string }[]>`
            SELECT cm."userId"
            FROM "ClubMember" AS cm
            JOIN "User" AS u ON u."id" = cm."userId"
            WHERE cm."clubId" = ${club.id}
              AND cm."userId" <> ${userId}
            ORDER BY
              CASE WHEN u."deletedAt" IS NULL THEN 0 ELSE 1 END,
              CASE cm."role"
                WHEN 'ADMIN' THEN 0
                WHEN 'MODERATOR' THEN 1
                ELSE 2
              END,
              cm."joinedAt" ASC,
              cm."id" ASC
            LIMIT 1
            FOR UPDATE OF cm, u
          `;
          if (successor) {
            await tx.clubMember.update({
              where: { clubId_userId: { clubId: club.id, userId: successor.userId } },
              data: { role: 'ADMIN' },
            });
            await tx.club.update({
              where: { id: club.id },
              data: { ownerId: successor.userId },
            });
          } else {
            await tx.club.delete({ where: { id: club.id } });
            deletedClubIds.push(club.id);
          }
        }

        const [acceptedFollows, memberships] = await Promise.all([
          tx.follow.findMany({
            where: {
              status: 'ACCEPTED',
              OR: [{ followerId: userId }, { followingId: userId }],
            },
            select: { followerId: true, followingId: true },
          }),
          tx.clubMember.findMany({
            where: { userId, club: { ownerId: { not: userId } } },
            select: { clubId: true },
          }),
        ]);
        const affectedUserIds = [
          ...new Set(
            acceptedFollows
              .flatMap(edge => [edge.followerId, edge.followingId])
              .filter(id => id !== userId),
          ),
        ].sort();
        const affectedClubIds = [...new Set(memberships.map(row => row.clubId))].sort();

        if (affectedUserIds.length > 0) {
          await tx.$queryRaw(Prisma.sql`
            SELECT "id" FROM "User"
            WHERE "id" IN (${Prisma.join(affectedUserIds)})
            ORDER BY "id" FOR UPDATE
          `);
        }
        if (affectedClubIds.length > 0) {
          await tx.$queryRaw(Prisma.sql`
            SELECT "id" FROM "Club"
            WHERE "id" IN (${Prisma.join(affectedClubIds)})
            ORDER BY "id" FOR UPDATE
          `);
        }

        const mediaToDelete = await prepareOwnedMediaForPurge(tx, userId);
        if (mediaToDelete.length > 0) {
          // No storage operation happens here. These envelopes and the User
          // cascade become visible together at commit; a SQL failure rolls
          // both back and leaves every byte untouched.
          await tx.outboxEvent.createMany({
            data: mediaToDelete.map(mediaDeletionOutboxData),
          });
        }

        const deletedClubIdSet = new Set(deletedClubIds);
        const clubCleanupEvents = [
          ...deletedClubIds.map(clubId => clubExtensionCleanupOutboxData(clubId, 'all')),
          ...[...new Set(promotedClubMetadataIds)]
            .filter(clubId => !deletedClubIdSet.has(clubId))
            .map(clubId => clubExtensionCleanupOutboxData(clubId, 'metadata')),
        ];
        if (clubCleanupEvents.length > 0) {
          await tx.outboxEvent.createMany({ data: clubCleanupEvents, skipDuplicates: true });
        }

        await tx.user.delete({ where: { id: userId } });

        if (affectedUserIds.length > 0) {
          await tx.$executeRaw(Prisma.sql`
            UPDATE "User" AS u
            SET "followerCount" = (
                  SELECT count(*)::integer FROM "Follow" f
                  WHERE f."followingId" = u."id" AND f."status" = 'ACCEPTED'
                ),
                "followingCount" = (
                  SELECT count(*)::integer FROM "Follow" f
                  WHERE f."followerId" = u."id" AND f."status" = 'ACCEPTED'
                ),
                "updatedAt" = CURRENT_TIMESTAMP
            WHERE u."id" IN (${Prisma.join(affectedUserIds)})
          `);
        }
        if (affectedClubIds.length > 0) {
          await tx.$executeRaw(Prisma.sql`
            UPDATE "Club" AS c
            SET "memberCount" = (
                  SELECT count(*)::integer FROM "ClubMember" cm WHERE cm."clubId" = c."id"
                ),
                "updatedAt" = CURRENT_TIMESTAMP
            WHERE c."id" IN (${Prisma.join(affectedClubIds)})
          `);
        }
        return true;
      },
      { maxWait: 10_000, timeout: 30_000 },
    ),
  );

/** Nightly safety net for legacy drift and interrupted old deployments. */
export const reconcileDenormalizedCounts = async (): Promise<void> => {
  await prisma.$transaction([
    prisma.$executeRaw`
      UPDATE "User" AS u
      SET "followerCount" = counts."followers",
          "followingCount" = counts."following",
          "updatedAt" = CURRENT_TIMESTAMP
      FROM (
        SELECT u2."id",
          (SELECT count(*)::integer FROM "Follow" f WHERE f."followingId" = u2."id" AND f."status" = 'ACCEPTED') AS "followers",
          (SELECT count(*)::integer FROM "Follow" f WHERE f."followerId" = u2."id" AND f."status" = 'ACCEPTED') AS "following"
        FROM "User" u2
      ) counts
      WHERE u."id" = counts."id"
        AND (u."followerCount", u."followingCount") IS DISTINCT FROM (counts."followers", counts."following")
    `,
    prisma.$executeRaw`
      UPDATE "Club" AS c
      SET "memberCount" = counts."members", "updatedAt" = CURRENT_TIMESTAMP
      FROM (
        SELECT c2."id",
          (SELECT count(*)::integer FROM "ClubMember" cm WHERE cm."clubId" = c2."id") AS "members"
        FROM "Club" c2
      ) counts
      WHERE c."id" = counts."id" AND c."memberCount" IS DISTINCT FROM counts."members"
    `,
  ]);
};

/**
 * A deletion request should not allow another recurring charge during the
 * grace period. Retry pending end-of-period cancellation daily in case Stripe
 * was unavailable when the user made the request.
 */
const scheduleDeletedUserSubscriptionCancellations = async (): Promise<void> => {
  try {
    const subscriptions = await prisma.subscription.findMany({
      where: { user: { deletedAt: { not: null } } },
      select: { userId: true },
    });
    for (const { userId } of subscriptions) {
      try {
        await scheduleStripeCancellation(userId);
      } catch (err) {
        logger.error('gdpr-purge: failed to schedule Stripe subscription cancellation', {
          userId,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }
  } catch (err) {
    logger.error('gdpr-purge: subscription-cancellation lookup failed', {
      err: err instanceof Error ? err.message : String(err),
    });
  }
};

/**
 * (a) Hard-delete users whose soft-delete grace period has elapsed.
 *
 * NOTE: there is NO `permanentDeletionAt` column in the schema. The real
 * signal is `deletedAt` (set when the user requests deletion) plus a grace
 * window (ACCOUNT_DELETION_GRACE_DAYS, default 30 days). We hard-delete users
 * where `deletedAt` is non-null AND `deletedAt <= now - graceDays`.
 *
 * All child relations (Message, GroupMessage, Follow, RefreshToken,
 * PasswordResetToken, Notification, Participant, ClubMember, RoomRsvp, Block,
 * Report, ConversationMember, AuditLog authored, …) are `onDelete: Cascade`,
 * so a single `prisma.user.delete` cascades at the DB level. The self-relation
 * `invitedBy` is `SetNull`, so invitees survive with `invitedById = null`.
 *
 * We resolve the target ids first, then delete each inside a transaction so
 * the per-user cascade is atomic.
 */
const purgeSoftDeletedUsers = async (now: number): Promise<void> => {
  try {
    const graceDays = env.ACCOUNT_DELETION_GRACE_DAYS;
    const cutoff = new Date(now - graceDays * DAY_MS);

    const victims = await prisma.user.findMany({
      where: { deletedAt: { not: null, lte: cutoff } },
      select: { id: true },
    });

    let deleted = 0;
    for (const v of victims) {
      try {
        // Stripe teardown is the pre-commit external gate: keeping local
        // identifiers intact lets the next scheduled run retry it safely.
        // Object-storage deletion is instead authorized durably by the SQL
        // transaction below and retried from its post-commit outbox envelope.
        await teardownStripeForUser(v.id);
        // Redis extension state is outside PostgreSQL's cascade. Purge or
        // anonymize it first, and fail closed so a Redis outage is retryable.
        const promotedClubMetadataIds = await purgeExtensionDataForUser(v.id);
        if (await hardDeleteUserWithRelationalRepair(v.id, promotedClubMetadataIds)) deleted += 1;
      } catch (err) {
        // A single user failing (e.g. a transient FK race) must not abort the
        // batch — log and continue with the next id.
        logger.error('gdpr-purge: failed to hard-delete user', {
          userId: v.id,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }

    logger.info('gdpr-purge: hard-deleted soft-deleted users', {
      candidates: victims.length,
      deleted,
      graceDays,
    });
  } catch (err) {
    logger.error('gdpr-purge: user hard-delete step failed', {
      err: err instanceof Error ? err.message : String(err),
    });
  }
};

/**
 * (b) Delete refresh tokens that are expired or revoked for more than a day.
 *
 * NOTE: the schema uses `revokedAt DateTime?` — there is NO `isRevoked`
 * boolean. We delete where the token expired more than a day ago, OR where it
 * was revoked more than a day ago. The 1-day buffer keeps very recently
 * expired/revoked rows around briefly for debugging / replay-attack forensics.
 */
const purgeRefreshTokens = async (now: number): Promise<void> => {
  try {
    const oneDayAgo = new Date(now - DAY_MS);
    const res = await prisma.refreshToken.deleteMany({
      where: {
        OR: [
          { expiresAt: { lt: oneDayAgo } },
          { AND: [{ revokedAt: { not: null } }, { revokedAt: { lt: oneDayAgo } }] },
        ],
      },
    });
    logger.info('gdpr-purge: deleted expired/revoked refresh tokens', { deleted: res.count });
  } catch (err) {
    logger.error('gdpr-purge: refresh-token step failed', {
      err: err instanceof Error ? err.message : String(err),
    });
  }
};

/**
 * (c) Delete OTP codes expired more than an hour ago. OTPs are single-use and
 * short-lived; a 1-hour buffer is generous.
 */
const purgeOtpCodes = async (now: number): Promise<void> => {
  try {
    const oneHourAgo = new Date(now - HOUR_MS);
    const res = await prisma.otpCode.deleteMany({
      where: { expiresAt: { lt: oneHourAgo } },
    });
    logger.info('gdpr-purge: deleted expired OTP codes', { deleted: res.count });
  } catch (err) {
    logger.error('gdpr-purge: otp-code step failed', {
      err: err instanceof Error ? err.message : String(err),
    });
  }
};

/**
 * (d) Delete password-reset tokens expired more than a day ago. Covers both
 * used and unused tokens once they are past expiry.
 */
const purgePasswordResetTokens = async (now: number): Promise<void> => {
  try {
    const oneDayAgo = new Date(now - DAY_MS);
    const res = await prisma.passwordResetToken.deleteMany({
      where: { expiresAt: { lt: oneDayAgo } },
    });
    logger.info('gdpr-purge: deleted expired password-reset tokens', { deleted: res.count });
  } catch (err) {
    logger.error('gdpr-purge: password-reset-token step failed', {
      err: err instanceof Error ? err.message : String(err),
    });
  }
};

/**
 * (e) Delete audit logs older than the retention window
 * (AUDIT_LOG_RETENTION_DAYS, default 90 days). Storage-limitation principle.
 */
const purgeAuditLogs = async (now: number): Promise<void> => {
  try {
    const retentionDays = env.AUDIT_LOG_RETENTION_DAYS;
    const cutoff = new Date(now - retentionDays * DAY_MS);
    const res = await prisma.auditLog.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });
    logger.info('gdpr-purge: deleted aged audit logs', {
      deleted: res.count,
      retentionDays,
    });
  } catch (err) {
    logger.error('gdpr-purge: audit-log step failed', {
      err: err instanceof Error ? err.message : String(err),
    });
  }
};

const purgeIdempotencyKeys = async (now: number): Promise<void> => {
  try {
    const res = await prisma.idempotencyKey.deleteMany({
      where: { expiresAt: { lt: new Date(now) } },
    });
    logger.info('gdpr-purge: deleted expired idempotency keys', { deleted: res.count });
  } catch (err) {
    logger.error('gdpr-purge: idempotency-key step failed', {
      err: err instanceof Error ? err.message : String(err),
    });
  }
};

/** Ephemeral room reactions are not an indefinite behavioural history. */
const purgeRoomReactions = async (now: number): Promise<void> => {
  try {
    const retentionDays = env.AUDIT_LOG_RETENTION_DAYS;
    const cutoff = new Date(now - retentionDays * DAY_MS);
    const res = await prisma.roomReaction.deleteMany({ where: { createdAt: { lt: cutoff } } });
    logger.info('gdpr-purge: deleted aged room reactions', {
      deleted: res.count,
      retentionDays,
    });
  } catch (err) {
    logger.error('gdpr-purge: room-reaction step failed', {
      err: err instanceof Error ? err.message : String(err),
    });
  }
};

const reconcileCounts = async (): Promise<void> => {
  try {
    await reconcileDenormalizedCounts();
    logger.info('gdpr-purge: reconciled denormalized counts');
  } catch (err) {
    logger.error('gdpr-purge: counter reconciliation failed', {
      err: err instanceof Error ? err.message : String(err),
    });
  }
};

/**
 * The job processor. Runs every retention step in sequence; each step owns its
 * own try/catch so one failure never aborts the others.
 */
const processPurge = async (): Promise<void> => {
  const now = Date.now();
  logger.info('gdpr-purge: starting daily retention sweep');
  await scheduleDeletedUserSubscriptionCancellations();
  await purgeSoftDeletedUsers(now);
  await purgeRefreshTokens(now);
  await purgeOtpCodes(now);
  await purgePasswordResetTokens(now);
  await purgeAuditLogs(now);
  await purgeIdempotencyKeys(now);
  await purgeRoomReactions(now);
  await reconcileCounts();
  logger.info('gdpr-purge: retention sweep complete');
};

/**
 * Start the worker and schedule the daily repeatable job idempotently.
 *
 * Wired into `app.ts` startServer() alongside the other in-process workers.
 * Before adding the repeatable we clear any existing repeatable of the same
 * name so a changed cron pattern between versions can't leave an orphaned
 * repeatable that double-fires.
 */
export const registerGdprPurgeWorker = async (): Promise<void> => {
  if (worker) return;

  worker = new Worker(GDPR_PURGE_QUEUE_NAME, processPurge, {
    connection: bullConnection(),
  });

  worker.on('failed', (job, err) => {
    logger.error('gdpr-purge job failed', { jobId: job?.id, err: err.message });
  });

  const q = getGdprPurgeQueue();
  for (const r of await q.getRepeatableJobs()) {
    if (r.name === GDPR_PURGE_JOB_NAME) await q.removeRepeatableByKey(r.key);
  }
  await q.add(
    GDPR_PURGE_JOB_NAME,
    {},
    {
      repeat: { pattern: PURGE_CRON },
      removeOnComplete: true,
      removeOnFail: { age: 7 * 24 * 3600 },
    },
  );

  logger.info('gdpr-purge worker registered', { cron: PURGE_CRON });
};

/**
 * Tear down the worker and queue. Called from `app.ts` graceful shutdown.
 */
export const shutdownGdprPurge = async (): Promise<void> => {
  if (worker) {
    await worker.close();
    worker = null;
  }
  await closeGdprPurgeQueue();
};
