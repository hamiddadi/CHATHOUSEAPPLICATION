import { Worker } from 'bullmq';
import { logger } from '../config/logger';
import { prisma } from '../config/database';
import { redis } from '../config/redis';
import { bullConnection } from '../queues/connection';
import { requireStripe, stripeConfigured } from '../extensions/modules/payments/stripe.client';
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

// Configurable via env (no env.ts change required — read defensively with
// sane defaults). Recommended additions to env.ts are noted in the manifest.
const PURGE_CRON = process.env.GDPR_PURGE_CRON ?? '0 3 * * *';

let worker: Worker | null = null;

/**
 * PAYM-05: cancel the user's Stripe subscription + delete the Stripe customer
 * BEFORE the prisma hard-delete (which cascade-removes the Subscription row,
 * losing the Stripe ids). A purged premium user would otherwise keep being
 * billed and their PII would linger at Stripe.
 *
 * Best-effort: no-op when Stripe isn't configured, and every Stripe call is
 * wrapped so a failure is logged (logger.warn) but never blocks the purge —
 * the hard-delete must proceed regardless.
 */
const teardownStripeForUser = async (userId: string): Promise<void> => {
  if (!stripeConfigured()) return;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      stripeCustomerId: true,
      subscription: { select: { stripeSubscriptionId: true } },
    },
  });
  if (!user) return;
  const subscriptionId = user.subscription?.stripeSubscriptionId;
  const customerId = user.stripeCustomerId;
  if (!subscriptionId && !customerId) return;

  let stripe;
  try {
    stripe = await requireStripe();
  } catch (err) {
    logger.warn('gdpr-purge: Stripe unavailable, skipping subscription/customer teardown', {
      userId,
      err: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  if (subscriptionId) {
    try {
      await stripe.subscriptions.cancel(subscriptionId);
    } catch (err) {
      logger.warn('gdpr-purge: failed to cancel Stripe subscription', {
        userId,
        subscriptionId,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }
  if (customerId) {
    try {
      await stripe.customers.del(customerId);
    } catch (err) {
      logger.warn('gdpr-purge: failed to delete Stripe customer', {
        userId,
        customerId,
        err: err instanceof Error ? err.message : String(err),
      });
    }
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
    const graceDays = Number(process.env.ACCOUNT_DELETION_GRACE_DAYS ?? 30);
    const cutoff = new Date(now - graceDays * DAY_MS);

    const victims = await prisma.user.findMany({
      where: { deletedAt: { not: null, lte: cutoff } },
      select: { id: true },
    });

    let deleted = 0;
    for (const v of victims) {
      try {
        // PAYM-05: cancel the Stripe subscription + delete the customer BEFORE the
        // cascade delete wipes the Subscription row (and its Stripe ids). Best-effort
        // — a Stripe failure is logged inside and never blocks the purge.
        await teardownStripeForUser(v.id);
        await prisma.$transaction(async tx => {
          await tx.user.delete({ where: { id: v.id } });
        });
        deleted += 1;
        // PAYM-03: the Stripe Connect mapping lives in Redis (not cascaded by the
        // DB delete). Leaving it orphaned lets a later tip pass the in-app guards
        // and then loop the webhook on the FK violation. Purge the mapping + its
        // onboarding lock. Best-effort: a Redis failure must not roll back the
        // (already committed) hard-delete, so it is logged but not rethrown.
        try {
          await redis.del([`ext:stripe:account:${v.id}`, `ext:stripe:account:${v.id}:lock`]);
        } catch (redisErr) {
          logger.error('gdpr-purge: failed to purge Stripe Redis mapping', {
            userId: v.id,
            err: redisErr instanceof Error ? redisErr.message : String(redisErr),
          });
        }
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
    const retentionDays = Number(process.env.AUDIT_LOG_RETENTION_DAYS ?? 90);
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

/**
 * The job processor. Runs every retention step in sequence; each step owns its
 * own try/catch so one failure never aborts the others.
 */
const processPurge = async (): Promise<void> => {
  const now = Date.now();
  logger.info('gdpr-purge: starting daily retention sweep');
  await purgeSoftDeletedUsers(now);
  await purgeRefreshTokens(now);
  await purgeOtpCodes(now);
  await purgePasswordResetTokens(now);
  await purgeAuditLogs(now);
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
