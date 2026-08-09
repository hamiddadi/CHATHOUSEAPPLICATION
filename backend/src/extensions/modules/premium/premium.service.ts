import { Prisma } from '@prisma/client';
import { prisma } from '../../../config/database';
import { env } from '../../../config/env';
import { extError } from '../../utils/ExtAppError';
import {
  assertCurrency,
  requireReturnUrls,
  requireStripe,
  stripeConfigured,
  type StripeCheckoutSessionObject,
  type StripeSubscriptionObject,
} from '../payments/stripe.client';

/**
 * Premium subscription via Stripe-hosted Checkout (subscription mode) + the
 * Stripe billing portal. Entitlement (User.isPremium / premiumUntil +
 * Subscription row) is the SERVER-SIDE source of truth, written ONLY by the
 * verified webhook — never trusted from the client. Feature-flagged via
 * STRIPE_SECRET_KEY. Premium gates the extended profile-links cap (MVP).
 */

const ACTIVE_STATUSES = ['active', 'trialing'];

export interface StripeSyncEvent {
  id: string;
  created: number;
}

const stripeTimestamp = (seconds: number, field: string): Date => {
  if (!Number.isSafeInteger(seconds) || seconds < 0) {
    throw extError('PAY_INVALID', `Invalid Stripe ${field} timestamp`);
  }
  const timestamp = new Date(seconds * 1000);
  if (Number.isNaN(timestamp.getTime())) {
    throw extError('PAY_INVALID', `Invalid Stripe ${field} timestamp`);
  }
  return timestamp;
};

const isActiveStatus = (status: string): boolean => ACTIVE_STATUSES.includes(status);

/**
 * Stripe only guarantees eventual delivery, not delivery order. For events
 * created in the same second, prefer revocation over activation (fail closed)
 * because event ids themselves are opaque and carry no ordering guarantee.
 */
const shouldApplySameSubscription = (
  current: {
    status: string;
    lastStripeEventCreatedAt: Date | null;
    lastStripeEventId: string | null;
  },
  incomingStatus: string,
  event: StripeSyncEvent,
): boolean => {
  if (!current.lastStripeEventCreatedAt) return true;

  const incomingTime = stripeTimestamp(event.created, 'event.created').getTime();
  const currentTime = current.lastStripeEventCreatedAt.getTime();
  if (incomingTime < currentTime) return false;
  if (incomingTime > currentTime) return true;
  if (current.lastStripeEventId === event.id) return false;

  return isActiveStatus(current.status) && !isActiveStatus(incomingStatus);
};

export interface PremiumStatus {
  configured: boolean;
  premium: boolean;
  until: string | null;
  status: string | null;
}

/** Reuse the user's Stripe customer, creating one on first checkout. */
const getOrCreateCustomer = async (userId: string): Promise<string> => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, stripeCustomerId: true },
  });
  if (!user) throw extError('PAY_INVALID', 'User not found');
  if (user.stripeCustomerId) return user.stripeCustomerId;

  const stripe = await requireStripe();
  // PAYM-06: a deterministic idempotency key means a retried create (network
  // blip, double-tap, redelivery) returns the SAME customer instead of spawning
  // an orphan.
  const customer = await stripe.customers.create(
    {
      metadata: { chathouseUserId: userId },
      ...(user.email ? { email: user.email } : {}),
    },
    { idempotencyKey: `cust:${userId}` },
  );
  // Only claim the id if no concurrent checkout already set one (avoids
  // orphaning a customer on a double-tap). The loser re-reads the winner's id.
  const res = await prisma.user.updateMany({
    where: { id: userId, stripeCustomerId: null },
    data: { stripeCustomerId: customer.id },
  });
  if (res.count === 0) {
    const fresh = await prisma.user.findUnique({
      where: { id: userId },
      select: { stripeCustomerId: true },
    });
    return fresh?.stripeCustomerId ?? customer.id;
  }
  return customer.id;
};

export const premiumService = {
  configured: stripeConfigured,

  /** Server-side entitlement status for the client (badge + gating UI). */
  async getStatus(userId: string): Promise<PremiumStatus> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { isPremium: true, premiumUntil: true, subscription: { select: { status: true } } },
    });
    // PAYM-08: stay consistent with isPremium() — a lapsed period is not premium
    // even if the webhook that flips the flag hasn't landed yet.
    const lapsed = Boolean(user?.premiumUntil && user.premiumUntil.getTime() < Date.now());
    return {
      configured: stripeConfigured(),
      premium: Boolean(user?.isPremium) && !lapsed,
      until: user?.premiumUntil ? user.premiumUntil.toISOString() : null,
      status: user?.subscription?.status ?? null,
    };
  },

  /** True iff the user has a live premium entitlement (server-side). */
  async isPremium(userId: string): Promise<boolean> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { isPremium: true, premiumUntil: true },
    });
    if (!user?.isPremium) return false;
    // Defensive: treat a lapsed period as not-premium even if the webhook that
    // flips the flag hasn't landed yet.
    if (user.premiumUntil && user.premiumUntil.getTime() < Date.now()) return false;
    return true;
  },

  /** Throw PREMIUM_REQUIRED unless the user has a live entitlement. */
  async requirePremium(userId: string): Promise<void> {
    if (!(await this.isPremium(userId))) throw extError('PREMIUM_REQUIRED');
  },

  /** Create a subscription Checkout session; returns the hosted-page URL. */
  async createCheckout(userId: string, currencyInput: string): Promise<{ url: string }> {
    if (!stripeConfigured()) throw extError('PREMIUM_NOT_CONFIGURED');
    const currency = assertCurrency(currencyInput);
    const { returnUrl, refreshUrl } = requireReturnUrls();
    const customerId = await getOrCreateCustomer(userId);
    const stripe = await requireStripe();
    // Repeated taps/retries in the same hour return the same hosted Checkout
    // session. Currency and price bind the key to an identical request.
    const checkoutWindow = Math.floor(Date.now() / (60 * 60 * 1000));
    const session = await stripe.checkout.sessions.create(
      {
        mode: 'subscription',
        customer: customerId,
        client_reference_id: userId,
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency,
              unit_amount: env.PREMIUM_PRICE_CENTS,
              recurring: { interval: 'month' },
              product_data: { name: env.PREMIUM_PRODUCT_NAME },
            },
          },
        ],
        subscription_data: { metadata: { chathouseUserId: userId } },
        metadata: { chathouseUserId: userId },
        success_url: returnUrl,
        cancel_url: refreshUrl,
      },
      {
        idempotencyKey: `premium-checkout:${userId}:${currency}:${env.PREMIUM_PRICE_CENTS}:${checkoutWindow}`,
      },
    );
    if (!session.url) throw extError('PAY_INVALID', 'Checkout session has no URL');
    return { url: session.url };
  },

  /** Create a Stripe billing-portal session so the user can manage/cancel. */
  async createPortal(userId: string): Promise<{ url: string }> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { stripeCustomerId: true },
    });
    if (!user?.stripeCustomerId) throw extError('PREMIUM_NO_SUBSCRIPTION');
    const { returnUrl } = requireReturnUrls();
    const stripe = await requireStripe();
    const portal = await stripe.billingPortal.sessions.create({
      customer: user.stripeCustomerId,
      return_url: returnUrl,
    });
    return { url: portal.url };
  },

  /**
   * Webhook helper — mirror a Stripe subscription into our DB + flip the user's
   * entitlement. Resolves the user from subscription metadata, falling back to
   * the customer→user mapping. The ONLY writer of isPremium/premiumUntil.
   */
  async syncSubscription(sub: StripeSubscriptionObject, event: StripeSyncEvent): Promise<void> {
    let userId = sub.metadata?.['chathouseUserId'];
    if (!userId) {
      const u = await prisma.user.findFirst({
        where: { stripeCustomerId: sub.customer },
        select: { id: true },
      });
      userId = u?.id;
    }
    if (!userId) return;

    // PAYM-04: the user may have been purged (GDPR) while the Stripe sub is still
    // active — Stripe then emits subscription.updated/deleted. An unconditional
    // user.update would throw P2025 → 500 → infinite Stripe retries. Confirm the
    // user still exists and short-circuit (ACK) if not.
    const exists = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!exists) return;

    // Rows created before the ordering columns were deployed have no Stripe
    // ordering marker. Hydrate them from Stripe's current snapshot before
    // applying even a same-id event: otherwise the first delayed event after
    // deployment could still reactivate a subscription that is already
    // canceled. If Stripe is unavailable, fail closed and let the webhook retry.
    const before = await prisma.subscription.findUnique({
      where: { userId },
      select: {
        stripeSubscriptionId: true,
        stripeSubscriptionCreatedAt: true,
        lastStripeEventCreatedAt: true,
      },
    });
    let effectiveSub = sub;
    let effectiveEvent = event;
    let legacySubscriptionCreatedAt: Date | null = null;
    if (before && before.stripeSubscriptionId === sub.id && !before.lastStripeEventCreatedAt) {
      const stripe = await requireStripe();
      effectiveSub = await stripe.subscriptions.retrieve(before.stripeSubscriptionId);
      effectiveEvent = {
        id: event.id,
        created: Math.max(event.created, Math.floor(Date.now() / 1000)),
      };
    } else if (
      before &&
      before.stripeSubscriptionId !== sub.id &&
      !before.stripeSubscriptionCreatedAt
    ) {
      const stripe = await requireStripe();
      const currentStripeSubscription = await stripe.subscriptions.retrieve(
        before.stripeSubscriptionId,
      );
      legacySubscriptionCreatedAt = stripeTimestamp(
        currentStripeSubscription.created,
        'subscription.created',
      );
    }

    const active = isActiveStatus(effectiveSub.status);
    const stripeSubscriptionCreatedAt = stripeTimestamp(
      effectiveSub.created,
      'subscription.created',
    );
    const lastStripeEventCreatedAt = stripeTimestamp(effectiveEvent.created, 'event.created');
    const currentPeriodEnd = effectiveSub.current_period_end
      ? new Date(effectiveSub.current_period_end * 1000)
      : null;

    await prisma.$transaction(
      async tx => {
        const current = await tx.subscription.findUnique({
          where: { userId },
          select: {
            stripeSubscriptionId: true,
            stripeSubscriptionCreatedAt: true,
            status: true,
            lastStripeEventCreatedAt: true,
            lastStripeEventId: true,
          },
        });

        if (current) {
          if (current.stripeSubscriptionId === effectiveSub.id) {
            if (!shouldApplySameSubscription(current, effectiveSub.status, effectiveEvent)) return;
          } else {
            const currentCreatedAt =
              current.stripeSubscriptionCreatedAt ??
              (current.stripeSubscriptionId === before?.stripeSubscriptionId
                ? legacySubscriptionCreatedAt
                : null);

            // A different id may replace the row only when Stripe proves it is
            // a strictly newer subscription. Stripe ids are opaque, so two ids
            // created in the same second cannot be ordered safely: retain the
            // current id, so an ambiguous active subscription can never
            // re-enable an inactive entitlement, until later reconciliation.
            // Once replaced, no update/deletion from the superseded id can alter the
            // entitlement, regardless of that event's delivery time.
            if (!currentCreatedAt) {
              throw extError('PAY_INVALID', 'Cannot order Stripe subscriptions safely');
            }
            if (stripeSubscriptionCreatedAt.getTime() <= currentCreatedAt.getTime()) return;
          }

          await tx.subscription.update({
            where: { userId },
            data: {
              stripeSubscriptionId: effectiveSub.id,
              stripeCustomerId: effectiveSub.customer,
              stripeSubscriptionCreatedAt,
              lastStripeEventCreatedAt,
              lastStripeEventId: effectiveEvent.id,
              status: effectiveSub.status,
              currentPeriodEnd,
            },
          });
        } else {
          await tx.subscription.create({
            data: {
              userId,
              stripeSubscriptionId: effectiveSub.id,
              stripeCustomerId: effectiveSub.customer,
              stripeSubscriptionCreatedAt,
              lastStripeEventCreatedAt,
              lastStripeEventId: effectiveEvent.id,
              status: effectiveSub.status,
              currentPeriodEnd,
            },
          });
        }

        await tx.user.update({
          where: { id: userId },
          data: { isPremium: active, premiumUntil: active ? currentPeriodEnd : null },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  },

  /** Webhook helper — on checkout completion, pull the subscription and sync. */
  async syncFromCheckout(
    session: StripeCheckoutSessionObject,
    event: StripeSyncEvent,
  ): Promise<void> {
    if (session.mode !== 'subscription' || !session.subscription) return;
    const stripe = await requireStripe();
    const sub = await stripe.subscriptions.retrieve(session.subscription);
    // The retrieved object is a current Stripe snapshot, not the historical
    // state from checkout completion. Timestamp it at observation time so a
    // delayed pre-snapshot subscription event cannot regress that state. Keep
    // Stripe's signed event time as the lower bound if the server clock lags.
    const observedAt = Math.max(event.created, Math.floor(Date.now() / 1000));
    await this.syncSubscription(sub, { id: event.id, created: observedAt });
  },
};
