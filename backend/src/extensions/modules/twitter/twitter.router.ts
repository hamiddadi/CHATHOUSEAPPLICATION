import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../../middlewares/auth.middleware';
import { asyncHandler } from '../../../utils/asyncHandler';
import { twitterService } from './twitter.service';

export const twitterRouter: Router = Router();

twitterRouter.use(requireAuth);

const urlSchema = z.object({
  state: z.string().min(8).max(128),
  codeChallenge: z.string().min(8).max(200),
});

const exchangeSchema = z.object({
  code: z.string().min(1).max(500),
  codeVerifier: z.string().min(8).max(200),
});

twitterRouter.get(
  '/status',
  asyncHandler(async (_req, res) => {
    res.json({ configured: twitterService.configured() });
  }),
);

twitterRouter.post(
  '/url',
  asyncHandler(async (req, res) => {
    const { state, codeChallenge } = urlSchema.parse(req.body);
    const url = twitterService.authorizeUrl(state, codeChallenge);
    res.json({ url });
  }),
);

twitterRouter.post(
  '/exchange',
  asyncHandler(async (req, res) => {
    const { code, codeVerifier } = exchangeSchema.parse(req.body);
    const profile = await twitterService.exchange(code, codeVerifier);
    res.json(profile);
  }),
);
