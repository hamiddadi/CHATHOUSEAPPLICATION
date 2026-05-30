import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../../middlewares/auth.middleware';
import { asyncHandler } from '../../../utils/asyncHandler';
import { TOPICS, FLAT_TOPICS } from './topics.data';

export const topicsRouter: Router = Router();

topicsRouter.use(requireAuth);

topicsRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    res.json({ topics: TOPICS, total: FLAT_TOPICS.length });
  }),
);

const querySchema = z.object({
  q: z.string().min(1).max(64).optional(),
  parent: z.string().optional(),
});

topicsRouter.get(
  '/flat',
  asyncHandler(async (req, res) => {
    const { q, parent } = querySchema.parse(req.query);
    let results = FLAT_TOPICS;
    if (parent !== undefined) {
      results = results.filter(t => t.parent === (parent === 'null' ? null : parent));
    }
    if (q) {
      const needle = q.toLowerCase();
      results = results.filter(
        t => t.label.toLowerCase().includes(needle) || t.slug.includes(needle),
      );
    }
    res.json({ items: results, total: results.length });
  }),
);
