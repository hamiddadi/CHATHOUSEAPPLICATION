import { Worker } from 'bullmq';
import { logger } from '../config/logger';
import { prisma } from '../config/database';
import { env } from '../config/env';
import { bullConnection } from '../queues/connection';
import {
  scheduleStripeCancellation,
  teardownStripeForUser,
} from '../extensions/modules/payments/stripe.gdpr';
import { mediaService } from '../modules/media/media.service';
import { purgeExtensionDataForUser } from '../extensions/gdpr';
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
        // External Stripe and object-storage cleanup both fail closed. Keeping
        // local identifiers intact lets the next scheduled run retry safely.
        await teardownStripeForUser(v.id);
        // Redis extension state is outside PostgreSQL's cascade. Purge or
        // anonymize it first, and fail closed so a Redis outage is retryable.
        await purgeExtensionDataForUser(v.id);
        // Object bytes are external to PostgreSQL. Fail closed if storage is
        // unavailable so the metadata remains retryable and no personal data
        // is orphaned by a successful relational cascade.
        const deletedMediaObjects = await mediaService.deleteAllForUser(v.id);
        await prisma.$transaction(async tx => {
          await tx.user.delete({ where: { id: v.id } });
        });
        deleted += 1;
        logger.info('gdpr-purge: deleted private media objects', {
          userId: v.id,
          deleted: deletedMediaObjects,
        });
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
