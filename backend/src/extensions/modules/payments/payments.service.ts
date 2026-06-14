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
 * Stripe account IDs are still mapped userId→account in Redis (legacy); the
 * webhook keeps the cached KYC flag fresh via account.updated.
 */

interface StripeAccountMapping {
  stripeAccountId: string;
  kycComplete: boolean;
  createdAt: string;
}

/** Minimal shape of a Stripe Charge object (charge.refunded webhook, PAYM-02). */
interface StripeChargeObject {
  id: string;
  payment_intent?: string | null;
}

const accountKey = (userId: string) => `ext:stripe:account:${userId}`;

/** Window over which identical tip retries collapse onto the same session (1 min). */
const TIP_IDEMPOTENCY_WINDOW_MS = 60_000;

export const paymentsService = {
  configured: stripeConfigured,

  /**
   * Onboard a creator on Stripe Connect Express. Returns the AccountLink URL
   * the mobile app opens for KYC. Return/refresh URLs fail closed when unset.
   */
  async onboardCreator(userId: string): Promise<{ url: string; accountId: string }> {
    const { returnUrl, refreshUrl } = requireReturnUrls();
    const stripe = await requireStripe();
    const existing = await redis.get(accountKey(userId));
    let accountId: string;
    if (existing) {
      const parsed = JSON.parse(existing) as StripeAccountMapping;
      accountId = parsed.stripeAccountId;
    } else {
      // Guard against two concurrent onboard requests (double tap) both seeing
      // `existing === null` and each creating a Stripe account — one of which
      // would be orphaned. A short Redis NX lock serialises the create.
      const lockKey = `${accountKey(userId)}:lock`;
      const gotLock = await redis.set(lockKey, '1', { NX: true, EX: 30 });
      if (!gotLock) {
        const raced = await redis.get(accountKey(userId));
        if (raced) {
          const parsed = JSON.parse(raced) as StripeAccountMapping;
          accountId = parsed.stripeAccountId;
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
        const mapping: StripeAccountMapping = {
          stripeAccountId: accountId,
          kycComplete: false,
          createdAt: new Date().toISOString(),
        };
        await redis.set(accountKey(userId), JSON.stringify(mapping), { NX: true });
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
  ): Promise<{ url: string }> {
    if (amountCents <= 0) throw extError('PAY_INVALID', 'Amount must be positive');
    if (fromUserId === toUserId) throw extError('PAY_INVALID', 'Cannot tip yourself');
    const currency = assertCurrency(currencyInput);

    // PAYM-03: validate the recipient in the DB BEFORE charging. The Redis
    // account mapping survives a GDPR purge, so a tip could otherwise be
    // captured + transferred and then fail the FK on recordTip (boucle de
    // retry). Reject if the user no longer exists or is soft-deleted.
    const toUser = await prisma.user.findUnique({
      where: { id: toUserId },
      select: { deletedAt: true },
    });
    if (!toUser || toUser.deletedAt) throw extError('PAY_RECIPIENT_NOT_CONFIGURED');

    const recipient = await redis.get(accountKey(toUserId));
    if (!recipient) throw extError('PAY_RECIPIENT_NOT_CONFIGURED');
    const mapping = JSON.parse(recipient) as StripeAccountMapping;
    if (!mapping.kycComplete) throw extError('PAY_KYC_INCOMPLETE');

    const { returnUrl, refreshUrl } = requireReturnUrls();
    const stripe = await requireStripe();
    // Idempotency: a double-submitted tip (network retry, double tap) within the
    // window collapses onto the same Checkout session rather than charging twice.
    const idemKey = `tipco:${fromUserId}:${toUserId}:${amountCents}:${currency}:${Math.floor(
      Date.now() / TIP_IDEMPOTENCY_WINDOW_MS,
    )}`;
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
    const raw = await redis.get(accountKey(userId));
    if (!raw) return;
    const mapping = JSON.parse(raw) as StripeAccountMapping;
    const kycComplete = Boolean(account.payouts_enabled && account.charges_enabled);
    if (kycComplete !== mapping.kycComplete) {
      mapping.kycComplete = kycComplete;
      await redis.set(accountKey(userId), JSON.stringify(mapping));
    }
  },

  /** Tip history for a user (sent + received), newest first. Confirmed tips only. */
  async listTips(userId: string) {
    const rows = await prisma.tip.findMany({
      where: { status: 'SUCCEEDED', OR: [{ fromUserId: userId }, { toUserId: userId }] },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return rows.map(t => ({
      id: t.id,
      direction: t.fromUserId === userId ? ('sent' as const) : ('received' as const),
      fromUserId: t.fromUserId,
      toUserId: t.toUserId,
      amount: t.amount,
      currency: t.currency,
      createdAt: t.createdAt,
    }));
  },
};
