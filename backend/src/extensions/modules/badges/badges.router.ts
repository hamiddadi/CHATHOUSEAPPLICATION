import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireAdmin } from '../../../middlewares/auth.middleware';
import { asyncHandler } from '../../../utils/asyncHandler';
import { badgesService } from './badges.service';

export const badgesRouter: Router = Router();

badgesRouter.use(requireAuth);

const userIdParamSchema = z.object({ userId: z.string().min(1).max(40) });

const badgeSchema = z.object({
  badge: z.enum(['verified', 'top_speaker', 'early', 'host', 'club_owner', 'nominator', 'staff']),
});

badgesRouter.get(
  '/:userId',
  asyncHandler(async (req, res) => {
    const { userId } = userIdParamSchema.parse(req.params);
    const items = await badgesService.list(userId);
    res.json({ items });
  }),
);

// Admin-only mutations
badgesRouter.post(
  '/:userId/grant',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { userId } = userIdParamSchema.parse(req.params);
    const { badge } = badgeSchema.parse(req.body);
    await badgesService.grant(userId, badge);
    res.json({ granted: badge });
  }),
);

badgesRouter.post(
  '/:userId/revoke',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { userId } = userIdParamSchema.parse(req.params);
    const { badge } = badgeSchema.parse(req.body);
    await badgesService.revoke(userId, badge);
    res.json({ revoked: badge });
  }),
);
