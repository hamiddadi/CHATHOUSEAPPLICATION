import { prisma } from '../../config/database';
import { env } from '../../config/env';
import { logger } from '../../config/logger';
import { redis } from '../../config/redis';
import { AppError } from '../../middlewares/error.middleware';
import { restoreStripeSubscription } from '../../extensions/modules/payments/stripe.gdpr';

const DAY_MS = 24 * 60 * 60 * 1000;

interface LoginAccountState {
  id: string;
  deletedAt: Date | null;
  suspendedUntil: Date | null;
}

/**
 * Enforce account state after credentials have been proven, but before a new
 * session is minted. A self-deleted account is restored only during the
 * configured grace period. An active moderation suspension (including the
 * year-9999 sentinel used for admin deletions) always wins.
 */
export const ensureLoginAllowedAndRestore = async (
  account: LoginAccountState,
): Promise<{ restored: boolean }> => {
  const now = new Date();
  if (account.suspendedUntil && account.suspendedUntil > now) {
    throw new AppError('AUTH_007');
  }
  if (!account.deletedAt) return { restored: false };

  const cutoff = new Date(now.getTime() - env.ACCOUNT_DELETION_GRACE_DAYS * DAY_MS);
  if (account.deletedAt <= cutoff) {
    throw new AppError('AUTH_003', 'Account deletion grace period has expired');
  }

  const restored = await prisma.user.updateMany({
    where: {
      id: account.id,
      deletedAt: { not: null, gt: cutoff },
      OR: [{ suspendedUntil: null }, { suspendedUntil: { lte: now } }],
    },
    data: { deletedAt: null },
  });

  if (restored.count !== 1) {
    // A second concurrent login may observe that the first one already
    // restored the account. Re-read authoritatively before deciding.
    const current = await prisma.user.findUnique({
      where: { id: account.id },
      select: { deletedAt: true, suspendedUntil: true },
    });
    if (!current) throw new AppError('AUTH_003');
    if (current.suspendedUntil && current.suspendedUntil > now) {
      throw new AppError('AUTH_007');
    }
    if (current.deletedAt) throw new AppError('AUTH_003');
    return { restored: false };
  }

  // A deletion request primes this key to `d`; drop it immediately so the new
  // session sees the freshly restored DB state.
  await redis.del(`user:susp:${account.id}`);
  await restoreStripeSubscription(account.id).catch(err => {
    // Account restoration must not be held hostage by a payment-provider
    // outage. The user can still manage or recreate billing afterwards.
    logger.warn('account-restoration: failed to resume pending Stripe subscription', {
      userId: account.id,
      err: err instanceof Error ? err.message : String(err),
    });
  });
  return { restored: true };
};
