import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../../middlewares/auth.middleware';
import { asyncHandler } from '../../../utils/asyncHandler';
import { authedUserId } from '../../../utils/authedUserId';
import { suggestionsService } from './suggestions.service';

export const suggestionsRouter: Router = Router();

suggestionsRouter.use(requireAuth);

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).optional().default(20),
});

suggestionsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { limit } = querySchema.parse(req.query);
    const userId = authedUserId(req);
    const items = await suggestionsService.forUser(userId, limit);
    res.json({ items, count: items.length });
  }),
);
