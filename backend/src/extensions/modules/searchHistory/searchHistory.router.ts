import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../../middlewares/auth.middleware';
import { asyncHandler } from '../../../utils/asyncHandler';
import { authedUserId } from '../../../utils/authedUserId';
import { searchHistoryService } from './searchHistory.service';

export const searchHistoryRouter: Router = Router();

searchHistoryRouter.use(requireAuth);

const recordSchema = z.object({ query: z.string().trim().min(1).max(100) });

searchHistoryRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const items = await searchHistoryService.list(authedUserId(req));
    res.json({ items });
  }),
);

searchHistoryRouter.post(
  '/record',
  asyncHandler(async (req, res) => {
    const { query } = recordSchema.parse(req.body);
    await searchHistoryService.record(authedUserId(req), query);
    res.json({ recorded: true });
  }),
);

searchHistoryRouter.delete(
  '/',
  asyncHandler(async (req, res) => {
    await searchHistoryService.clear(authedUserId(req));
    res.json({ cleared: true });
  }),
);

searchHistoryRouter.delete(
  '/item',
  asyncHandler(async (req, res) => {
    const { query } = recordSchema.parse(req.body);
    await searchHistoryService.removeOne(authedUserId(req), query);
    res.json({ removed: true });
  }),
);
