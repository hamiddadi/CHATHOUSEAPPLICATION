import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../../middlewares/auth.middleware';
import { asyncHandler } from '../../../utils/asyncHandler';
import { authedUserId } from '../../../utils/authedUserId';
import { presenceService } from './presence.service';

export const presenceRouter: Router = Router();

presenceRouter.use(requireAuth);

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).optional().default(30),
});

presenceRouter.get(
  '/available',
  asyncHandler(async (req, res) => {
    const { limit } = querySchema.parse(req.query);
    const userId = authedUserId(req);
    const items = await presenceService.availableForUser(userId, limit);
    res.json({ items, count: items.length });
  }),
);
