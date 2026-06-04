import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../../middlewares/auth.middleware';
import { asyncHandler } from '../../../utils/asyncHandler';
import { authedUserId } from '../../../utils/authedUserId';
import { recentlyPlayedService } from './recentlyPlayed.service';

export const recentlyPlayedRouter: Router = Router();

recentlyPlayedRouter.use(requireAuth);

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).optional().default(20),
});

recentlyPlayedRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { limit } = querySchema.parse(req.query);
    const items = await recentlyPlayedService.list(authedUserId(req), limit);
    res.json({ items, count: items.length });
  }),
);

recentlyPlayedRouter.post(
  '/:roomId/touch',
  asyncHandler(async (req, res) => {
    await recentlyPlayedService.touch(authedUserId(req), String(req.params.roomId));
    res.json({ touched: true });
  }),
);
