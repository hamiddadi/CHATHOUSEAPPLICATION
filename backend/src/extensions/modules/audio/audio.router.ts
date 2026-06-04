import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../../middlewares/auth.middleware';
import { asyncHandler } from '../../../utils/asyncHandler';
import { authedUserId } from '../../../utils/authedUserId';
import { audioService } from './audio.service';

export const audioRouter: Router = Router();

audioRouter.use(requireAuth);

const tierSchema = z.enum(['standard', 'high', 'music']);
const dropInSchema = z.enum(['silent', 'normal']);

const patchSchema = z.object({
  qualityTier: tierSchema.optional(),
  spatialAudio: z.boolean().optional(),
  noiseSuppression: z.boolean().optional(),
  dropInMode: dropInSchema.optional(),
});

audioRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const prefs = await audioService.get(authedUserId(req));
    res.json({ ...prefs, hints: audioService.hintsForTier(prefs.qualityTier) });
  }),
);

audioRouter.patch(
  '/',
  asyncHandler(async (req, res) => {
    const patch = patchSchema.parse(req.body ?? {});
    const updated = await audioService.update(authedUserId(req), patch);
    res.json({ ...updated, hints: audioService.hintsForTier(updated.qualityTier) });
  }),
);
