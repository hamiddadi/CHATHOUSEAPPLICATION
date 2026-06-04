import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../../middlewares/auth.middleware';
import { asyncHandler } from '../../../utils/asyncHandler';
import { authedUserId } from '../../../utils/authedUserId';
import { profileLinksService } from './profileLinks.service';

export const profileLinksRouter: Router = Router();

profileLinksRouter.use(requireAuth);

const addSchema = z.object({
  label: z.string().trim().min(1).max(40),
  url: z.string().url().max(500),
  icon: z.string().max(16).nullable().optional(),
});

const patchSchema = z.object({
  label: z.string().trim().min(1).max(40).optional(),
  url: z.string().url().max(500).optional(),
  icon: z.string().max(16).nullable().optional(),
});

// Public read for any user
profileLinksRouter.get(
  '/:userId',
  asyncHandler(async (req, res) => {
    const items = await profileLinksService.list(String(req.params.userId));
    res.json({ items });
  }),
);

// Self-write only
profileLinksRouter.post(
  '/me',
  asyncHandler(async (req, res) => {
    const input = addSchema.parse(req.body);
    const items = await profileLinksService.add(authedUserId(req), input);
    res.status(201).json({ items });
  }),
);

profileLinksRouter.patch(
  '/me/:linkId',
  asyncHandler(async (req, res) => {
    const patch = patchSchema.parse(req.body);
    const items = await profileLinksService.update(
      authedUserId(req),
      String(req.params.linkId),
      patch,
    );
    res.json({ items });
  }),
);

profileLinksRouter.delete(
  '/me/:linkId',
  asyncHandler(async (req, res) => {
    const items = await profileLinksService.remove(authedUserId(req), String(req.params.linkId));
    res.json({ items });
  }),
);
