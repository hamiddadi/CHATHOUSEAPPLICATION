import { env } from '../../../config/env';
import { logger } from '../../../config/logger';
import { extError } from '../../utils/ExtAppError';

/**
 * Shared Stripe accessor for the payments + premium modules and the webhook.
 *
 * Stripe is a production dependency. The dynamic import keeps startup cheap;
 * when STRIPE_SECRET_KEY is unset callers get PAY_NOT_CONFIGURED.
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
  created: number;
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
  created: number;
  type: string;
  data: { object: Record<string, unknown> };
}

export interface StripeLike {
  accounts: {
    create(params: unknown, options?: { idempotencyKey?: string }): Promise<{ id: string }>;
    retrieve(id: string): Promise<StripeAccountObject>;
    del(id: string): Promise<{ id: string; deleted: boolean }>;
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
    create(params: unknown, options?: { idempotencyKey?: string }): Promise<{ id: string }>;
    // PAYM-05: delete a customer on GDPR hard-delete so a purged user stops
    // being billed and no PII lingers at Stripe.
    del(id: string): Promise<{ id: string; deleted: boolean }>;
  };
  subscriptions: {
    retrieve(id: string): Promise<StripeSubscriptionObject>;
    // PAYM-05: cancel the active subscription before the customer is deleted.
    cancel(id: string): Promise<StripeSubscriptionObject>;
    update(
      id: string,
      params: { cancel_at_period_end: boolean },
    ): Promise<StripeSubscriptionObject>;
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

export const stripeConfigured = (): boolean => Boolean(env.STRIPE_SECRET_KEY);

const load = async (): Promise<StripeLike | null> => {
  const secretKey = env.STRIPE_SECRET_KEY;
  if (!secretKey) return null;
  try {
    // Dynamic import avoids loading the SDK in a process where payments are
    // intentionally unconfigured.
    const mod = (await import(/* webpackIgnore: true */ 'stripe' as string)) as unknown as {
      default: new (key: string, opts?: unknown) => StripeLike;
    };
    const Stripe = mod.default;
    return new Stripe(secretKey, { maxNetworkRetries: 2 });
  } catch (err) {
    logger.error('ext.payments: failed to load the installed Stripe SDK', { err });
    return null;
  }
};

export const requireStripe = async (): Promise<StripeLike> => {
  const s = await load();
  if (!s) {
    throw extError('PAY_NOT_CONFIGURED', 'Stripe is not configured — set STRIPE_SECRET_KEY');
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
