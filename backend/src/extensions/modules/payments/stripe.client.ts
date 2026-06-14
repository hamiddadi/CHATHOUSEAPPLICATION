import { env } from '../../../config/env';
import { logger } from '../../../config/logger';
import { extError } from '../../utils/ExtAppError';

/**
 * Shared Stripe accessor for the payments + premium modules and the webhook.
 *
 * `stripe` is an OPTIONAL dynamic import — it is NOT a package.json dependency
 * and is never required at typecheck time. When STRIPE_SECRET_KEY is unset (or
 * the SDK isn't installed) every caller gets PAY_NOT_CONFIGURED and the feature
 * no-ops, exactly like the LiveKit/recording gating. The hand-written
 * `StripeLike` type covers only the SDK surface we call, so callers still get
 * real method signatures without the dependency.
 */

export interface StripeAccountObject {
  id: string;
  payouts_enabled?: boolean;
  charges_enabled?: boolean;
  metadata?: Record<string, string> | null;
}

export interface StripePaymentIntentObject {
  id: string;
  status?: string;
  amount?: number;
  currency?: string;
  metadata?: Record<string, string> | null;
}

export interface StripeSubscriptionObject {
  id: string;
  status: string;
  customer: string;
  current_period_end?: number;
  cancel_at_period_end?: boolean;
  metadata?: Record<string, string> | null;
}

export interface StripeCheckoutSessionObject {
  id: string;
  url: string | null;
  mode?: string;
  customer?: string | null;
  subscription?: string | null;
  client_reference_id?: string | null;
  metadata?: Record<string, string> | null;
}

export interface StripeEvent {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
}

export interface StripeLike {
  accounts: {
    create(params: unknown, options?: { idempotencyKey?: string }): Promise<{ id: string }>;
    retrieve(id: string): Promise<StripeAccountObject>;
  };
  accountLinks: { create(params: unknown): Promise<{ url: string }> };
  paymentIntents: {
    create(
      params: unknown,
      options?: { idempotencyKey?: string },
    ): Promise<{ id: string; client_secret: string | null }>;
  };
  checkout: {
    sessions: {
      create(
        params: unknown,
        options?: { idempotencyKey?: string },
      ): Promise<StripeCheckoutSessionObject>;
    };
  };
  customers: {
    create(params: unknown): Promise<{ id: string }>;
    // PAYM-05: delete a customer on GDPR hard-delete so a purged user stops
    // being billed and no PII lingers at Stripe.
    del(id: string): Promise<{ id: string; deleted: boolean }>;
  };
  subscriptions: {
    retrieve(id: string): Promise<StripeSubscriptionObject>;
    // PAYM-05: cancel the active subscription before the customer is deleted.
    cancel(id: string): Promise<StripeSubscriptionObject>;
  };
  billingPortal: { sessions: { create(params: unknown): Promise<{ url: string }> } };
  webhooks: {
    constructEvent(
      payload: string | Buffer,
      header: string | string[],
      secret: string,
    ): StripeEvent;
  };
}

export const stripeConfigured = (): boolean => Boolean(process.env.STRIPE_SECRET_KEY);

const load = async (): Promise<StripeLike | null> => {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) return null;
  try {
    // Dynamic import keeps the dependency optional. To enable Stripe, run
    // `npm i stripe` in backend/ and set STRIPE_SECRET_KEY.
    const mod = (await import(/* webpackIgnore: true */ 'stripe' as string)) as unknown as {
      default: new (key: string, opts?: unknown) => StripeLike;
    };
    const Stripe = mod.default;
    return new Stripe(secretKey, { apiVersion: '2024-06-20' });
  } catch (err) {
    logger.warn('ext.payments: stripe SDK not installed', { err });
    return null;
  }
};

export const requireStripe = async (): Promise<StripeLike> => {
  const s = await load();
  if (!s) {
    throw extError(
      'PAY_NOT_CONFIGURED',
      'Stripe is not configured — install `stripe` and set STRIPE_SECRET_KEY',
    );
  }
  return s;
};

/** First configured currency is the default the client uses when none is sent. */
export const defaultCurrency = (): string => env.PAYMENT_CURRENCIES[0] ?? 'usd';

/** Normalise + validate a currency against the configured allowlist. */
export const assertCurrency = (currency: string): string => {
  const c = currency.trim().toLowerCase();
  if (!env.PAYMENT_CURRENCIES.includes(c)) {
    throw extError('PAY_CURRENCY_UNSUPPORTED', `Unsupported currency: ${c}`);
  }
  return c;
};

/**
 * Return + refresh URLs for hosted Stripe pages (Connect onboarding, Checkout
 * success/cancel, billing portal). Fails closed when unset — we never send a
 * user to a placeholder domain.
 */
export const requireReturnUrls = (): { returnUrl: string; refreshUrl: string } => {
  const returnUrl = env.STRIPE_RETURN_URL;
  const refreshUrl = env.STRIPE_REFRESH_URL;
  if (!returnUrl || !refreshUrl) {
    throw extError('PAY_RETURN_URL_MISSING');
  }
  return { returnUrl, refreshUrl };
};
