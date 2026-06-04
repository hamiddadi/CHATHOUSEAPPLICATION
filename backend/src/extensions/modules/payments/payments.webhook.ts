import { Router, raw } from 'express';
import type { Request, Response } from 'express';
import { env } from '../../../config/env';
import { redis } from '../../../config/redis';
import { logger } from '../../../config/logger';
import { asyncHandler } from '../../../utils/asyncHandler';
import { premiumService } from '../premium/premium.service';
import { paymentsService } from './payments.service';
import {
  requireStripe,
  stripeConfigured,
  type StripeAccountObject,
  type StripeCheckoutSessionObject,
  type StripeEvent,
  type StripePaymentIntentObject,
  type StripeSubscriptionObject,
} from './stripe.client';

export const stripeWebhookRouter: Router = Router();

const evtKey = (id: string) => `ext:stripe:evt:${id}`;
const DEDUPE_TTL_S = 24 * 3600;

const dispatch = async (event: StripeEvent): Promise<void> => {
  switch (event.type) {
    case 'payment_intent.succeeded':
      await paymentsService.recordTip(event.data.object as unknown as StripePaymentIntentObject);
      break;
    case 'account.updated':
      await paymentsService.syncAccount(event.data.object as unknown as StripeAccountObject);
      break;
    case 'checkout.session.completed':
      await premiumService.syncFromCheckout(
        event.data.object as unknown as StripeCheckoutSessionObject,
      );
      break;
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
      await premiumService.syncSubscription(
        event.data.object as unknown as StripeSubscriptionObject,
      );
      break;
    default:
      // Unhandled event type — acknowledge so Stripe stops retrying.
      break;
  }
};

// Stripe posts events here. Signature verification needs the RAW body, so this
// router installs its own express.raw parser and MUST be mounted before the
// global JSON parser. Unauthenticated by design — the Stripe-Signature header
// (verified with STRIPE_WEBHOOK_SECRET) IS the auth. No-op when Stripe isn't
// configured; fails closed (no secret → cannot verify → reject).
stripeWebhookRouter.post(
  '/stripe',
  raw({ type: '*/*', limit: '1mb' }),
  asyncHandler(async (req: Request, res: Response) => {
    if (!stripeConfigured() || !env.STRIPE_WEBHOOK_SECRET) {
      // Not configured to receive/verify webhooks — refuse rather than trust.
      res.status(503).json({ error: 'webhooks not configured' });
      return;
    }
    const sig = req.get('stripe-signature');
    if (!sig) {
      res.status(400).json({ error: 'missing signature' });
      return;
    }
    const body: Buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');

    let event: StripeEvent;
    try {
      const stripe = await requireStripe();
      event = stripe.webhooks.constructEvent(body, sig, env.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
      logger.warn('ext.payments: webhook signature verification failed', {
        err: err instanceof Error ? err.message : err,
      });
      res.status(400).json({ error: 'invalid signature' });
      return;
    }

    // Idempotency: claim the event id so a Stripe retry is skipped. Handlers are
    // also idempotent (upserts), so a lost claim is still safe; on a processing
    // error we release the claim so the retry reprocesses.
    const claimed = await redis.set(evtKey(event.id), '1', { NX: true, EX: DEDUPE_TTL_S });
    if (!claimed) {
      res.json({ received: true, deduped: true });
      return;
    }

    try {
      await dispatch(event);
      res.json({ received: true });
    } catch (err) {
      // Release the dedupe claim so Stripe's retry reprocesses. If the release
      // itself fails, log it — a stale claim could otherwise dedupe (and drop)
      // the retry of an event that never actually succeeded.
      try {
        await redis.del(evtKey(event.id));
      } catch (delErr) {
        logger.warn('ext.payments: failed to release webhook claim', {
          id: event.id,
          err: delErr instanceof Error ? delErr.message : delErr,
        });
      }
      logger.error('ext.payments: webhook handler failed', {
        type: event.type,
        id: event.id,
        err: err instanceof Error ? err.message : err,
      });
      // 500 so Stripe retries the event.
      res.status(500).json({ error: 'handler failed' });
    }
  }),
);
