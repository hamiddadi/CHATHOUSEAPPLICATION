import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../../middlewares/auth.middleware';
import { asyncHandler } from '../../../utils/asyncHandler';
import { twitterService } from './twitter.service';

export const twitterRouter: Router = Router();

twitterRouter.use(requireAuth);

// PKCE runs server-side, so the client never sends a verifier — it only
// echoes back the `state` it received from /begin and the `code` Twitter
// handed it on redirect.
const completeSchema = z.object({
  state: z.string().min(8).max(128),
  code: z.string().min(1).max(500),
});

twitterRouter.get(
  '/status',
  asyncHandler(async (_req, res) => {
    res.json({ configured: twitterService.configured() });
  }),
);

twitterRouter.post(
  '/begin',
  asyncHandler(async (_req, res) => {
    const out = await twitterService.beginAuth();
    res.json(out);
  }),
);

twitterRouter.post(
  '/complete',
  asyncHandler(async (req, res) => {
    const { state, code } = completeSchema.parse(req.body);
    const profile = await twitterService.completeAuth(state, code);
    res.json(profile);
  }),
);
