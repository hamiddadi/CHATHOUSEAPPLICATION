import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireAdmin } from '../../../middlewares/auth.middleware';
import { sendLimiter } from '../../../middlewares/rateLimit.middleware';
import { asyncHandler } from '../../../utils/asyncHandler';
import { authedUserId } from '../../../utils/authedUserId';
import { nominatorService } from './nominator.service';

export const nominatorRouter: Router = Router();

nominatorRouter.use(requireAuth);

const inviteSchema = z.object({
  phone: z.string().min(7).max(20),
  name: z.string().trim().min(1).max(80),
});

const grantSchema = z.object({
  userId: z.string().min(1).max(40),
  delta: z.number().int().min(-10).max(10),
});

nominatorRouter.get(
  '/me',
  asyncHandler(async (req, res) => {
    const [remaining, history] = await Promise.all([
      nominatorService.remaining(authedUserId(req)),
      nominatorService.history(authedUserId(req)),
    ]);
    res.json({ remaining, history });
  }),
);

nominatorRouter.post(
  '/invite',
  // Phone-based invite (PII + potential outbound SMS) — throttle per the
  // same ceiling as other send routes, on top of the per-user invite quota.
  sendLimiter,
  asyncHandler(async (req, res) => {
    const { phone, name } = inviteSchema.parse(req.body);
    const result = await nominatorService.invite(authedUserId(req), phone, name);
    res.status(201).json(result);
  }),
);

// Admin-only: grant or remove invitations
nominatorRouter.post(
  '/grant',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { userId, delta } = grantSchema.parse(req.body);
    const remaining = await nominatorService.grant(userId, delta);
    res.json({ userId, remaining });
  }),
);
