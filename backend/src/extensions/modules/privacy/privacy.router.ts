import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../../middlewares/auth.middleware';
import { asyncHandler } from '../../../utils/asyncHandler';
import { authedUserId } from '../../../utils/authedUserId';
import { privacyService } from './privacy.service';

export const privacyRouter: Router = Router();

privacyRouter.use(requireAuth);

const patchSchema = z.object({
  isPrivateAccount: z.boolean().optional(),
  allowWaves: z.boolean().optional(),
  isVisibleOnMap: z.boolean().optional(),
});

privacyRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json(await privacyService.get(authedUserId(req)));
  }),
);

privacyRouter.patch(
  '/',
  asyncHandler(async (req, res) => {
    const patch = patchSchema.parse(req.body ?? {});
    const updated = await privacyService.update(authedUserId(req), patch);
    res.json(updated);
  }),
);
