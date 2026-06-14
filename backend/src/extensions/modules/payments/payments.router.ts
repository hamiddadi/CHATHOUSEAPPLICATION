import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../../middlewares/auth.middleware';
import { sendLimiter } from '../../../middlewares/rateLimit.middleware';
import { asyncHandler } from '../../../utils/asyncHandler';
import { authedUserId } from '../../../utils/authedUserId';
import { paymentsService } from './payments.service';
import { defaultCurrency } from './stripe.client';

export const paymentsRouter: Router = Router();

paymentsRouter.use(requireAuth);

paymentsRouter.get(
  '/status',
  asyncHandler(async (_req, res) => {
    res.json({ configured: paymentsService.configured() });
  }),
);

paymentsRouter.post(
  '/onboard',
  // Creating Stripe accounts has a cost/quota — throttle the onboarding endpoint.
  sendLimiter,
  asyncHandler(async (req, res) => {
    const result = await paymentsService.onboardCreator(authedUserId(req));
    res.json(result);
  }),
);

paymentsRouter.get(
  '/account',
  asyncHandler(async (req, res) => {
    const result = await paymentsService.getAccountStatus(authedUserId(req));
    res.json(result);
  }),
);

paymentsRouter.get(
  '/tips',
  asyncHandler(async (req, res) => {
    const result = await paymentsService.listTips(authedUserId(req));
    res.json(result);
  }),
);

const tipSchema = z.object({
  toUserId: z.string().min(1).max(40),
  amountCents: z.number().int().min(100).max(50_000),
  // Optional — resolved to the server's default currency when omitted. Validated
  // against the configured allowlist in the service.
  currency: z.string().min(3).max(8).optional(),
  // PAYM-07: optional client-supplied nonce. Two legitimate identical tips (same
  // sender/recipient/amount in the idempotency window) would otherwise collapse
  // onto one Checkout session; a distinct nonce keeps them separate. A repeated
  // nonce (network retry, double tap) still de-duplicates as before.
  nonce: z.string().min(1).max(64).optional(),
});

paymentsRouter.post(
  '/tip',
  // Financial side effect — throttle (sendLimiter does NOT skip successes), in
  // addition to the Stripe idempotency key set in the service.
  sendLimiter,
  asyncHandler(async (req, res) => {
    const { toUserId, amountCents, currency, nonce } = tipSchema.parse(req.body);
    const result = await paymentsService.tip(
      authedUserId(req),
      toUserId,
      amountCents,
      currency ?? defaultCurrency(),
      nonce,
    );
    res.json(result);
  }),
);
