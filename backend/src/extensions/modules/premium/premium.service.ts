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
  // an orphan. The StripeLike.customers.create signature omits the options arg;
  // narrow-cast locally so we can pass it without touching the shared type.
  const createCustomer = stripe.customers.create as (
    params: unknown,
    options?: { idempotencyKey?: string },
  ) => Promise<{ id: string }>;
  const customer = await createCustomer(
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
    const session = await stripe.checkout.sessions.create({
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
    });
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
  async syncSubscription(sub: StripeSubscriptionObject): Promise<void> {
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

    const active = ACTIVE_STATUSES.includes(sub.status);
    const currentPeriodEnd = sub.current_period_end
      ? new Date(sub.current_period_end * 1000)
      : null;

    await prisma.subscription.upsert({
      where: { userId },
      create: {
        userId,
        stripeSubscriptionId: sub.id,
        stripeCustomerId: sub.customer,
        status: sub.status,
        currentPeriodEnd,
      },
      update: {
        stripeSubscriptionId: sub.id,
        stripeCustomerId: sub.customer,
        status: sub.status,
        currentPeriodEnd,
      },
    });
    await prisma.user.update({
      where: { id: userId },
      data: { isPremium: active, premiumUntil: active ? currentPeriodEnd : null },
    });
  },

  /** Webhook helper — on checkout completion, pull the subscription and sync. */
  async syncFromCheckout(session: StripeCheckoutSessionObject): Promise<void> {
    if (session.mode !== 'subscription' || !session.subscription) return;
    const stripe = await requireStripe();
    const sub = await stripe.subscriptions.retrieve(session.subscription);
    await this.syncSubscription(sub);
  },
};
