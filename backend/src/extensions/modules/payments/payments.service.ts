import { redis } from '../../../config/redis';
import { extError } from '../../utils/ExtAppError';
import { logger } from '../../../config/logger';

/**
 * Stripe Connect payments scaffolding (Module 14 / PAY-001..015).
 *
 * Wraps the Stripe SDK behind a feature-flag environment variable
 * (`STRIPE_SECRET_KEY`). When the key is absent, every endpoint returns a
 * structured `PAY_NOT_CONFIGURED` error so the mobile client can hide the
 * tip button gracefully. No DB schema change — Stripe IDs (account/intent)
 * are mapped to userId via Redis until a proper migration is added.
 *
 * Required env vars (to be provided by the deployer):
 *   - STRIPE_SECRET_KEY            sk_test_xxx or sk_live_xxx
 *   - STRIPE_CONNECT_CLIENT_ID     ca_xxx (for Express accounts)
 *   - STRIPE_RETURN_URL            https://app.chathouse.com/payments/return
 *   - STRIPE_REFRESH_URL           https://app.chathouse.com/payments/refresh
 */

interface StripeAccountMapping {
  stripeAccountId: string;
  kycComplete: boolean;
  createdAt: string;
}

const accountKey = (userId: string) => `ext:stripe:account:${userId}`;

/** Fallback onboarding URLs when STRIPE_RETURN_URL / STRIPE_REFRESH_URL are unset. */
const RETURN_URL_FALLBACK = 'https://example.com/return';
const REFRESH_URL_FALLBACK = 'https://example.com/refresh';
/** Window over which identical tip retries collapse onto the same intent (1 min). */
const TIP_IDEMPOTENCY_WINDOW_MS = 60_000;

const isConfigured = (): boolean => Boolean(process.env.STRIPE_SECRET_KEY);

const loadStripe = async (): Promise<unknown | null> => {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) return null;
  try {
    // Dynamic import — keeps the dependency optional. To enable Stripe
    // payments, install `stripe` via `pnpm add stripe` in backend/.
    const stripe = (await import(/* webpackIgnore: true */ 'stripe' as string)) as unknown as {
      default: new (key: string, opts?: unknown) => unknown;
    };
    const Stripe = stripe.default;
    return new Stripe(secretKey, {
      apiVersion: '2024-06-20',
    });
  } catch (err) {
    logger.warn('ext.payments: stripe SDK not installed', { err });
    return null;
  }
};

const requireStripe = async () => {
  const s = await loadStripe();
  if (!s) {
    throw extError(
      'PAY_NOT_CONFIGURED',
      'Stripe is not configured — install `stripe` and set STRIPE_SECRET_KEY',
    );
  }
  return s as {
    accounts: {
      create: (params: unknown, options?: { idempotencyKey?: string }) => Promise<{ id: string }>;
      retrieve: (id: string) => Promise<{ payouts_enabled?: boolean; charges_enabled?: boolean }>;
    };
    accountLinks: {
      create: (params: unknown) => Promise<{ url: string }>;
    };
    paymentIntents: {
      create: (
        params: unknown,
        options?: { idempotencyKey?: string },
      ) => Promise<{ id: string; client_secret: string | null }>;
    };
  };
};

export const paymentsService = {
  configured: isConfigured,

  /**
   * Onboard a creator on Stripe Connect Express. Returns the AccountLink
   * URL the mobile app should open in a webview for KYC.
   */
  async onboardCreator(userId: string): Promise<{ url: string; accountId: string }> {
    const stripe = await requireStripe();
    const existing = await redis.get(accountKey(userId));
    let accountId: string;
    if (existing) {
      const parsed = JSON.parse(existing) as StripeAccountMapping;
      accountId = parsed.stripeAccountId;
    } else {
      // Guard against two concurrent onboard requests (double tap) both
      // seeing `existing === null` and each creating a Stripe account —
      // one of which would be orphaned by the last write. A short Redis
      // NX lock serialises the create; the loser re-reads the mapping.
      const lockKey = `${accountKey(userId)}:lock`;
      const gotLock = await redis.set(lockKey, '1', { NX: true, EX: 30 });
      if (!gotLock) {
        const raced = await redis.get(accountKey(userId));
        if (raced) {
          const parsed = JSON.parse(raced) as StripeAccountMapping;
          accountId = parsed.stripeAccountId;
          const link = await stripe.accountLinks.create({
            account: accountId,
            return_url: process.env.STRIPE_RETURN_URL ?? RETURN_URL_FALLBACK,
            refresh_url: process.env.STRIPE_REFRESH_URL ?? REFRESH_URL_FALLBACK,
            type: 'account_onboarding',
          });
          return { url: link.url, accountId };
        }
      }
      try {
        const account = await stripe.accounts.create(
          {
            type: 'express',
            capabilities: {
              transfers: { requested: true },
            },
            metadata: { chathouseUserId: userId },
          },
          // Deterministic key so a retried create never duplicates the account.
          { idempotencyKey: `acct:${userId}` },
        );
        accountId = account.id;
        const mapping: StripeAccountMapping = {
          stripeAccountId: accountId,
          kycComplete: false,
          createdAt: new Date().toISOString(),
        };
        // NX so we never clobber a mapping a concurrent winner already wrote.
        await redis.set(accountKey(userId), JSON.stringify(mapping), { NX: true });
      } finally {
        if (gotLock) await redis.del(lockKey);
      }
    }
    const link = await stripe.accountLinks.create({
      account: accountId,
      return_url: process.env.STRIPE_RETURN_URL ?? RETURN_URL_FALLBACK,
      refresh_url: process.env.STRIPE_REFRESH_URL ?? REFRESH_URL_FALLBACK,
      type: 'account_onboarding',
    });
    return { url: link.url, accountId };
  },

  async getAccountStatus(
    userId: string,
  ): Promise<{ connected: boolean; kycComplete: boolean; accountId?: string }> {
    const raw = await redis.get(accountKey(userId));
    if (!raw) return { connected: false, kycComplete: false };
    const mapping = JSON.parse(raw) as StripeAccountMapping;
    try {
      const stripe = await requireStripe();
      const acc = await stripe.accounts.retrieve(mapping.stripeAccountId);
      const kycComplete = Boolean(acc.payouts_enabled && acc.charges_enabled);
      if (kycComplete !== mapping.kycComplete) {
        mapping.kycComplete = kycComplete;
        await redis.set(accountKey(userId), JSON.stringify(mapping));
      }
      return { connected: true, kycComplete, accountId: mapping.stripeAccountId };
    } catch {
      return {
        connected: true,
        kycComplete: mapping.kycComplete,
        accountId: mapping.stripeAccountId,
      };
    }
  },

  /**
   * Create a PaymentIntent for a tip to a creator. The amount is in
   * cents; presets are validated client-side ($2/$5/$10/$20) but any
   * value > 0 is accepted by the API.
   */
  async tip(
    fromUserId: string,
    toUserId: string,
    amountCents: number,
  ): Promise<{ clientSecret: string | null; paymentIntentId: string }> {
    if (amountCents <= 0) throw extError('PAY_INVALID', 'Amount must be positive');
    if (fromUserId === toUserId) throw extError('PAY_INVALID', 'Cannot tip yourself');

    const recipient = await redis.get(accountKey(toUserId));
    if (!recipient) throw extError('PAY_RECIPIENT_NOT_CONFIGURED');
    const mapping = JSON.parse(recipient) as StripeAccountMapping;
    if (!mapping.kycComplete) throw extError('PAY_KYC_INCOMPLETE');

    const stripe = await requireStripe();
    // Idempotency: a retried/double-submitted tip (network retry, double
    // tap) must not create a second PaymentIntent and double-charge. The
    // key is deterministic over (from, to, amount) within a 1-minute
    // window, so identical retries collapse onto the same intent while a
    // genuinely new tip a minute later still goes through.
    const idemKey = `tip:${fromUserId}:${toUserId}:${amountCents}:${Math.floor(Date.now() / TIP_IDEMPOTENCY_WINDOW_MS)}`;
    const intent = await stripe.paymentIntents.create(
      {
        amount: amountCents,
        currency: 'usd',
        automatic_payment_methods: { enabled: true },
        transfer_data: { destination: mapping.stripeAccountId },
        metadata: { fromUserId, toUserId, kind: 'tip' },
      },
      { idempotencyKey: idemKey },
    );
    return { clientSecret: intent.client_secret, paymentIntentId: intent.id };
  },
};
