import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../../middlewares/auth.middleware';
import { sendLimiter } from '../../../middlewares/rateLimit.middleware';
import { asyncHandler } from '../../../utils/asyncHandler';
import { authedUserId } from '../../../utils/authedUserId';
import { paymentsService } from './payments.service';

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

const tipSchema = z.object({
  toUserId: z.string().min(1).max(40),
  amountCents: z.number().int().min(100).max(50_000),
});

paymentsRouter.post(
  '/tip',
  // Financial side effect — throttle (sendLimiter does NOT skip successes), in
  // addition to the Stripe idempotency key set in the service.
  sendLimiter,
  asyncHandler(async (req, res) => {
    const { toUserId, amountCents } = tipSchema.parse(req.body);
    const result = await paymentsService.tip(authedUserId(req), toUserId, amountCents);
    res.json(result);
  }),
);
