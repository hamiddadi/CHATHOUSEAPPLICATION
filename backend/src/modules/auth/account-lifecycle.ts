import { env } from '../../config/env';
import { AppError } from '../../middlewares/error.middleware';

const DAY_MS = 24 * 60 * 60 * 1000;

export type AccountSessionScope = 'active' | 'account_recovery';

interface LoginAccountState {
  id: string;
  deletedAt: Date | null;
  suspendedUntil: Date | null;
}

/**
 * Resolve the only session scope credentials may receive. Proving credentials
 * never restores data by itself: a self-deleted account inside the grace
 * period receives a signed recovery-only session and must explicitly confirm
 * restoration. Active moderation sanctions always win.
 */
export const resolveAccountSessionScope = (account: LoginAccountState): AccountSessionScope => {
  const now = new Date();
  if (account.suspendedUntil && account.suspendedUntil > now) {
    throw new AppError('AUTH_007');
  }
  if (!account.deletedAt) return 'active';

  const cutoff = new Date(now.getTime() - env.ACCOUNT_DELETION_GRACE_DAYS * DAY_MS);
  if (account.deletedAt <= cutoff) {
    throw new AppError('AUTH_003', 'Account deletion grace period has expired');
  }
  return 'account_recovery';
};
