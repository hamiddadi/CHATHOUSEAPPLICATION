import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../../middlewares/auth.middleware';
import { sendLimiter } from '../../../middlewares/rateLimit.middleware';
import { asyncHandler } from '../../../utils/asyncHandler';
import { authedUserId } from '../../../utils/authedUserId';
import { defaultCurrency } from '../payments/stripe.client';
import { premiumService } from './premium.service';

export const premiumRouter: Router = Router();

premiumRouter.use(requireAuth);

// Server-side entitlement status — drives the premium badge + gating UI.
premiumRouter.get(
  '/status',
  asyncHandler(async (req, res) => {
    res.json(await premiumService.getStatus(authedUserId(req)));
  }),
);

const checkoutSchema = z.object({
  currency: z.string().min(3).max(8).optional(),
});

// Start a subscription Checkout — returns the hosted-page URL the client opens.
premiumRouter.post(
  '/checkout',
  sendLimiter,
  asyncHandler(async (req, res) => {
    const { currency } = checkoutSchema.parse(req.body ?? {});
    const result = await premiumService.createCheckout(
      authedUserId(req),
      currency ?? defaultCurrency(),
    );
    res.json(result);
  }),
);

// Open the Stripe billing portal so the user can update/cancel their plan.
premiumRouter.post(
  '/portal',
  sendLimiter,
  asyncHandler(async (req, res) => {
    res.json(await premiumService.createPortal(authedUserId(req)));
  }),
);
