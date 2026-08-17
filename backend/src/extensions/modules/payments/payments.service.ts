import { z } from 'zod';
import { prisma } from '../../../config/database';
import { redis } from '../../../config/redis';
import { extError } from '../../utils/ExtAppError';
import {
  assertCurrency,
  defaultCurrency,
  requireReturnUrls,
  requireStripe,
  stripeConfigured,
  type StripeAccountObject,
  type StripePaymentIntentObject,
} from './stripe.client';

/**
 * Stripe Connect tips (creator payouts).
 *
 * Tips go through Stripe-hosted Checkout (mode=payment, destination charge to
 * the creator's connected account) so no card data ever touches the app and no
 * client-side Stripe SDK is needed — the client just opens the returned URL.
 * The Tip ledger is written ONLY by the verified webhook (payment_intent
 * .succeeded), never by the client. Feature-flagged via STRIPE_SECRET_KEY.
 *
 * Stripe account IDs are durable on User.stripeConnectAccountId. Redis only
 * caches the current KYC flags and is rebuilt from PostgreSQL after eviction.
 */

interface StripeAccountMapping {
  stripeAccountId: string;
  kycComplete: boolean;
  createdAt: string;
}

const stripeAccountMappingSchema = z.object({
  stripeAccountId: z.string().regex(/^acct_[A-Za-z0-9]+$/),
  kycComplete: z.boolean(),
  createdAt: z.string(),
});

const parseAccountMapping = (raw: string): StripeAccountMapping => {
  try {
    return stripeAccountMappingSchema.parse(JSON.parse(raw));
  } catch {
    // Never trust malformed cache state for a financial destination.
    throw extError('PAY_RECIPIENT_NOT_CONFIGURED', 'Stored payout account is invalid');
  }
};

const isMissingStripeResource = (err: unknown): boolean =>
  typeof err === 'object' &&
  err !== null &&
  'code' in err &&
  (err as { code?: unknown }).code === 'resource_missing';

/** Minimal shape of a Stripe Charge object (charge.refunded webhook, PAYM-02). */
interface StripeChargeObject {
  id: string;
  payment_intent?: string | null;
}

const accountKey = (userId: string) => `ext:stripe:account:${userId}`;

/** Window over which identical tip retries collapse onto the same session (1 min). */
const TIP_IDEMPOTENCY_WINDOW_MS = 60_000;

const cacheAccountMapping = async (
  userId: string,
  mapping: StripeAccountMapping,
): Promise<void> => {
  await redis.set(accountKey(userId), JSON.stringify(mapping));
};

/**
 * Resolve the durable payout account and repair either side of the old
 * Redis-only mapping during rollout:
 * - PostgreSQL present, Redis absent/stale → rebuild the cache.
 * - legacy Redis present, PostgreSQL absent → persist it once.
 * PostgreSQL wins on disagreement so a poisoned cache can never redirect
 * money to a different destination.
 */
const accountMappingFor = async (userId: string): Promise<StripeAccountMapping | null> => {
  const [user, raw] = await Promise.all([
    prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { stripeConnectAccountId: true },
    }),
    redis.get(accountKey(userId)),
  ]);
  if (!user) return null;

  let cached: StripeAccountMapping | null = null;
  if (raw) {
    try {
      cached = parseAccountMapping(raw);
    } catch (err) {
      // A durable id lets us safely discard and repair malformed cache state.
      if (!user.stripeConnectAccountId) throw err;
    }
  }

  if (user.stripeConnectAccountId) {
    if (cached?.stripeAccountId === user.stripeConnectAccountId) return cached;
    const repaired = {
      stripeAccountId: user.stripeConnectAccountId,
      kycComplete: false,
      createdAt: new Date().toISOString(),
    };
    await cacheAccountMapping(userId, repaired);
    return repaired;
  }

  if (!cached) return null;
  try {
    const persisted = await prisma.user.updateMany({
      where: { id: userId, deletedAt: null, stripeConnectAccountId: null },
      data: { stripeConnectAccountId: cached.stripeAccountId },
    });
    if (persisted.count !== 1) return null;
  } catch {
    // A connected account may belong to only one local user.
    throw extError('PAY_RECIPIENT_NOT_CONFIGURED', 'Payout account ownership is invalid');
  }
  return cached;
};

const persistAccountId = async (userId: string, accountId: string): Promise<void> => {
  try {
    const persisted = await prisma.user.updateMany({
      where: {
        id: userId,
        deletedAt: null,
        OR: [{ stripeConnectAccountId: null }, { stripeConnectAccountId: accountId }],
      },
      data: { stripeConnectAccountId: accountId },
    });
    if (persisted.count !== 1) {
      throw extError('PAY_RECIPIENT_NOT_CONFIGURED', 'Payout account ownership is invalid');
    }
  } catch (err) {
    if (typeof err === 'object' && err !== null && 'code' in err && err.code === 'P2002') {
      throw extError('PAY_RECIPIENT_NOT_CONFIGURED', 'Payout account ownership is invalid');
    }
    throw err;
  }
};

export const paymentsService = {
  configured: stripeConfigured,

  /**
   * Onboard a creator on Stripe Connect Express. Returns the AccountLink URL
   * the mobile app opens for KYC. Return/refresh URLs fail closed when unset.
   */
  async onboardCreator(userId: string): Promise<{ url: string; accountId: string }> {
    const { returnUrl, refreshUrl } = requireReturnUrls();
    const stripe = await requireStripe();
    const existing = await accountMappingFor(userId);
    let accountId: string;
    if (existing) {
      accountId = existing.stripeAccountId;
    } else {
      // Guard against two concurrent onboard requests (double tap) both seeing
      // `existing === null` and each creating a Stripe account — one of which
      // would be orphaned. A short Redis NX lock serialises the create.
      const lockKey = `${accountKey(userId)}:lock`;
      const gotLock = await redis.set(lockKey, '1', { NX: true, EX: 30 });
      if (!gotLock) {
        const raced = await accountMappingFor(userId);
        if (raced) {
          accountId = raced.stripeAccountId;
          const link = await stripe.accountLinks.create({
            account: accountId,
            return_url: returnUrl,
            refresh_url: refreshUrl,
            type: 'account_onboarding',
          });
          return { url: link.url, accountId };
        }
      }
      try {
        const account = await stripe.accounts.create(
          {
            type: 'express',
            capabilities: { transfers: { requested: true } },
            metadata: { chathouseUserId: userId },
          },
          // Deterministic key so a retried create never duplicates the account.
          { idempotencyKey: `acct:${userId}` },
        );
        accountId = account.id;
        await persistAccountId(userId, accountId);
        const mapping: StripeAccountMapping = {
          stripeAccountId: accountId,
          kycComplete: false,
          createdAt: new Date().toISOString(),
        };
        await cacheAccountMapping(userId, mapping);
      } finally {
        if (gotLock) await redis.del(lockKey);
      }
    }
    const link = await stripe.accountLinks.create({
      account: accountId,
      return_url: returnUrl,
      refresh_url: refreshUrl,
      type: 'account_onboarding',
    });
    return { url: link.url, accountId };
  },

  async getAccountStatus(
    userId: string,
  ): Promise<{ connected: boolean; kycComplete: boolean; accountId?: string }> {
    const mapping = await accountMappingFor(userId);
    if (!mapping) return { connected: false, kycComplete: false };
    try {
      const stripe = await requireStripe();
      const acc = await stripe.accounts.retrieve(mapping.stripeAccountId);
      const kycComplete = Boolean(acc.payouts_enabled && acc.charges_enabled);
      if (kycComplete !== mapping.kycComplete) {
        mapping.kycComplete = kycComplete;
        await cacheAccountMapping(userId, mapping);
      }
      return { connected: true, kycComplete, accountId: mapping.stripeAccountId };
    } catch (err) {
      if (!isMissingStripeResource(err)) throw err;
      await Promise.all([
        redis.del(accountKey(userId)),
        prisma.user.updateMany({
          where: { id: userId, stripeConnectAccountId: mapping.stripeAccountId },
          data: { stripeConnectAccountId: null },
        }),
      ]);
      return { connected: false, kycComplete: false };
    }
  },

  /**
   * Create a Stripe Checkout session for a tip to a creator (destination charge,
   * 100% to the creator — no platform fee). Returns the hosted-page URL; the
   * client opens it. The Tip row is created later by the webhook on
   * payment_intent.succeeded. `amountCents` is in the currency's minor units.
   */
  async tip(
    fromUserId: string,
    toUserId: string,
    amountCents: number,
    currencyInput: string,
    nonce?: string,
  ): Promise<{ url: string }> {
    if (amountCents <= 0) throw extError('PAY_INVALID', 'Amount must be positive');
    if (fromUserId === toUserId) throw extError('PAY_INVALID', 'Cannot tip yourself');
    const currency = assertCurrency(currencyInput);

    // PAYM-03: validate the recipient in the DB BEFORE charging. The Redis
    // account mapping survives a GDPR purge, so a tip could otherwise be
    // captured + transferred and then fail the FK on recordTip (boucle de
    // retry). Reject if the user no longer exists or is soft-deleted.
    const mapping = await accountMappingFor(toUserId);
    if (!mapping) throw extError('PAY_RECIPIENT_NOT_CONFIGURED');

    const { returnUrl, refreshUrl } = requireReturnUrls();
    const stripe = await requireStripe();
    // Redis only caches KYC state. Re-check Stripe immediately before creating
    // the destination so a newly restricted account fails closed.
    let account: StripeAccountObject;
    try {
      account = await stripe.accounts.retrieve(mapping.stripeAccountId);
    } catch (err) {
      if (!isMissingStripeResource(err)) throw err;
      await Promise.all([
        redis.del(accountKey(toUserId)),
        prisma.user.updateMany({
          where: { id: toUserId, stripeConnectAccountId: mapping.stripeAccountId },
          data: { stripeConnectAccountId: null },
        }),
      ]);
      throw extError('PAY_RECIPIENT_NOT_CONFIGURED');
    }
    const kycComplete = Boolean(account.payouts_enabled && account.charges_enabled);
    mapping.kycComplete = kycComplete;
    await cacheAccountMapping(toUserId, mapping);
    if (!kycComplete) {
      throw extError('PAY_KYC_INCOMPLETE');
    }
    // Idempotency: a double-submitted tip (network retry, double tap) within the
    // window collapses onto the same Checkout session rather than charging twice.
    // PAYM-07: when the client supplies a nonce, it scopes the key instead of the
    // time window, so two legitimate identical tips (distinct nonces) stay
    // separate while a replayed nonce still de-duplicates. Falls back to the
    // time-window key when absent (backward compatible).
    const idemScope = nonce ?? `w${Math.floor(Date.now() / TIP_IDEMPOTENCY_WINDOW_MS)}`;
    const idemKey = `tipco:${fromUserId}:${toUserId}:${amountCents}:${currency}:${idemScope}`;
    const session = await stripe.checkout.sessions.create(
      {
        mode: 'payment',
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency,
              unit_amount: amountCents,
              product_data: { name: 'Tip' },
            },
          },
        ],
        payment_intent_data: {
          transfer_data: { destination: mapping.stripeAccountId },
          // Carried onto the PaymentIntent so the webhook can record the Tip.
          metadata: { fromUserId, toUserId, kind: 'tip' },
        },
        metadata: { fromUserId, toUserId, kind: 'tip' },
        success_url: returnUrl,
        cancel_url: refreshUrl,
      },
      { idempotencyKey: idemKey },
    );
    if (!session.url) throw extError('PAY_INVALID', 'Checkout session has no URL');
    return { url: session.url };
  },

  /**
   * Webhook helper — record a confirmed tip (idempotent on paymentIntentId).
   * Called from payment_intent.succeeded. Ignores non-tip intents and tips
   * whose users no longer exist (FK errors are swallowed by the caller).
   */
  async recordTip(intent: StripePaymentIntentObject): Promise<void> {
    const md = intent.metadata ?? {};
    if (md['kind'] !== 'tip') return;
    const fromUserId = md['fromUserId'];
    const toUserId = md['toUserId'];
    if (!fromUserId || !toUserId) return;
    // PAYM-02: do NOT clobber the status on conflict. The row is born SUCCEEDED
    // here; a later charge.refunded flips it to REFUNDED. Stripe can redeliver
    // payment_intent.succeeded for up to ~3 days (past the 24h dedupe window),
    // so an unconditional `update: { status: 'SUCCEEDED' }` would silently
    // reopen a refunded tip. An empty update keeps the first terminal status.
    await prisma.tip.upsert({
      where: { paymentIntentId: intent.id },
      create: {
        paymentIntentId: intent.id,
        fromUserId,
        toUserId,
        amount: intent.amount ?? 0,
        currency: intent.currency ?? defaultCurrency(),
        status: 'SUCCEEDED',
      },
      update: {},
    });
  },

  /**
   * Webhook helper — mark a tip FAILED on payment_intent.payment_failed (PAYM-01).
   * The intent never succeeded so no money moved; we only trace the failure if a
   * row exists (or create a FAILED row so the failure is visible). Idempotent on
   * paymentIntentId; never overwrites a SUCCEEDED/REFUNDED terminal row.
   */
  async recordFailedTip(intent: StripePaymentIntentObject): Promise<void> {
    const md = intent.metadata ?? {};
    if (md['kind'] !== 'tip') return;
    const fromUserId = md['fromUserId'];
    const toUserId = md['toUserId'];
    if (!fromUserId || !toUserId) return;
    await prisma.tip.upsert({
      where: { paymentIntentId: intent.id },
      create: {
        paymentIntentId: intent.id,
        fromUserId,
        toUserId,
        amount: intent.amount ?? 0,
        currency: intent.currency ?? defaultCurrency(),
        status: 'FAILED',
      },
      // Only a still-pending tip flips to FAILED; a SUCCEEDED/REFUNDED row is
      // terminal and must not be reopened by a stale failure event.
      update: {},
    });
    await prisma.tip.updateMany({
      where: { paymentIntentId: intent.id, status: 'PENDING' },
      data: { status: 'FAILED' },
    });
  },

  /**
   * Webhook helper — mark a tip REFUNDED on charge.refunded (PAYM-02). The charge
   * carries the originating paymentIntentId; we flip the matching SUCCEEDED tip
   * to REFUNDED. Idempotent and a no-op for non-tip / unknown charges.
   */
  async recordRefundedTip(charge: StripeChargeObject): Promise<void> {
    const paymentIntentId = charge.payment_intent;
    if (!paymentIntentId) return;
    await prisma.tip.updateMany({
      where: { paymentIntentId, status: 'SUCCEEDED' },
      data: { status: 'REFUNDED' },
    });
  },

  /** Webhook helper — sync the cached KYC flag when Stripe reports an account change. */
  async syncAccount(account: StripeAccountObject): Promise<void> {
    const userId = account.metadata?.['chathouseUserId'];
    if (!userId) return;
    const persisted = await prisma.user.updateMany({
      where: {
        id: userId,
        deletedAt: null,
        OR: [{ stripeConnectAccountId: null }, { stripeConnectAccountId: account.id }],
      },
      data: { stripeConnectAccountId: account.id },
    });
    // Ignore webhooks for purged users or a stale/orphan account whose metadata
    // points at a user now linked to a different payout account.
    if (persisted.count !== 1) return;
    const raw = await redis.get(accountKey(userId));
    let mapping: StripeAccountMapping = {
      stripeAccountId: account.id,
      kycComplete: false,
      createdAt: new Date().toISOString(),
    };
    if (raw) {
      try {
        const cached = parseAccountMapping(raw);
        if (cached.stripeAccountId === account.id) mapping = cached;
      } catch {
        // Rebuild malformed cache from the verified webhook object.
      }
    }
    const kycComplete = Boolean(account.payouts_enabled && account.charges_enabled);
    mapping.kycComplete = kycComplete;
    await cacheAccountMapping(userId, mapping);
  },

  /**
   * Tip history for a user (sent + received), newest first. Confirmed tips only.
   * Each row carries the public identity of the counterpart (recipient of a
   * sent tip / sender of a received one) so clients can render a readable name
   * instead of a raw user id.
   */
  async listTips(userId: string) {
    const publicIdentity = {
      select: { id: true, username: true, displayName: true, avatarUrl: true },
    } as const;
    const rows = await prisma.tip.findMany({
      where: { status: 'SUCCEEDED', OR: [{ fromUserId: userId }, { toUserId: userId }] },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { fromUser: publicIdentity, toUser: publicIdentity },
    });
    return rows.map(t => {
      const sent = t.fromUserId === userId;
      return {
        id: t.id,
        direction: sent ? ('sent' as const) : ('received' as const),
        fromUserId: t.fromUserId,
        toUserId: t.toUserId,
        amount: t.amount,
        currency: t.currency,
        createdAt: t.createdAt,
        counterpart: sent ? t.toUser : t.fromUser,
      };
    });
  },
};
