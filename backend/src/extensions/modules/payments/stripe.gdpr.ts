import { prisma } from '../../../config/database';
import { redis } from '../../../config/redis';
import { requireStripe, type StripeLike } from './stripe.client';

const accountKey = (userId: string): string => `ext:stripe:account:${userId}`;

interface ConnectedAccountMapping {
  stripeAccountId?: string;
}

const isMissingStripeResource = (err: unknown): boolean =>
  typeof err === 'object' &&
  err !== null &&
  'code' in err &&
  (err as { code?: unknown }).code === 'resource_missing';

const ignoreAlreadyMissing = async (operation: () => Promise<unknown>): Promise<void> => {
  try {
    await operation();
  } catch (err) {
    if (!isMissingStripeResource(err)) throw err;
  }
};

const subscriptionIdFor = async (userId: string): Promise<string | null> => {
  const row = await prisma.subscription.findUnique({
    where: { userId },
    select: { stripeSubscriptionId: true },
  });
  return row?.stripeSubscriptionId ?? null;
};

/**
 * Stop renewal as soon as an account enters its deletion grace window. The
 * customer is kept during the grace period so a restoration can undo a pending
 * end-of-period cancellation.
 */
export const scheduleStripeCancellation = async (userId: string): Promise<void> => {
  const subscriptionId = await subscriptionIdFor(userId);
  if (!subscriptionId) return;
  const stripe = await requireStripe();
  await ignoreAlreadyMissing(() =>
    stripe.subscriptions.update(subscriptionId, { cancel_at_period_end: true }),
  );
};

/** Undo a still-pending cancellation when a self-deleted account is restored. */
export const restoreStripeSubscription = async (userId: string): Promise<void> => {
  const subscriptionId = await subscriptionIdFor(userId);
  if (!subscriptionId) return;
  const stripe = await requireStripe();
  await ignoreAlreadyMissing(() =>
    stripe.subscriptions.update(subscriptionId, { cancel_at_period_end: false }),
  );
};

/**
 * Permanently remove known Stripe resources before the local hard-delete. Any
 * external failure is surfaced so the GDPR worker retries while the external
 * identifiers still exist in PostgreSQL/Redis.
 */
export const teardownStripeForUser = async (userId: string): Promise<void> => {
  const [user, rawConnectedAccount] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        stripeCustomerId: true,
        stripeConnectAccountId: true,
        subscription: { select: { stripeSubscriptionId: true } },
      },
    }),
    redis.get(accountKey(userId)),
  ]);
  if (!user) return;

  let connectedAccountId = user.stripeConnectAccountId;
  // Rollout compatibility for accounts onboarded before the durable column:
  // use the legacy cache only when PostgreSQL has no identifier yet.
  if (!connectedAccountId && rawConnectedAccount) {
    try {
      const parsed = JSON.parse(rawConnectedAccount) as ConnectedAccountMapping;
      connectedAccountId =
        typeof parsed.stripeAccountId === 'string' ? parsed.stripeAccountId : null;
    } catch {
      // A malformed cache is not a Stripe identifier and must never be sent to
      // the deletion API. Other durable resources are still cleaned below.
    }
  }

  const subscriptionId = user.subscription?.stripeSubscriptionId ?? null;
  const customerId = user.stripeCustomerId;
  if (!subscriptionId && !customerId && !connectedAccountId) return;

  const stripe: StripeLike = await requireStripe();
  if (subscriptionId) {
    await ignoreAlreadyMissing(() => stripe.subscriptions.cancel(subscriptionId));
  }
  if (customerId) {
    await ignoreAlreadyMissing(() => stripe.customers.del(customerId));
  }
  if (connectedAccountId) {
    await ignoreAlreadyMissing(() => stripe.accounts.del(connectedAccountId));
  }

  await redis.del([accountKey(userId), `${accountKey(userId)}:lock`]);
};
