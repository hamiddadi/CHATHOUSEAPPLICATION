import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../../middlewares/auth.middleware';
import { asyncHandler } from '../../../utils/asyncHandler';
import { authedUserId } from '../../../utils/authedUserId';
import { captionsService } from './captions.service';

export const captionsRouter: Router = Router();

captionsRouter.use(requireAuth);

const enabledSchema = z.object({ enabled: z.boolean() });

captionsRouter.get(
  '/status',
  asyncHandler(async (_req, res) => {
    res.json({ configured: captionsService.isConfigured() });
  }),
);

captionsRouter.get(
  '/:roomId',
  asyncHandler(async (req, res) => {
    const enabled = await captionsService.isEnabled(String(req.params.roomId));
    res.json({ enabled });
  }),
);

captionsRouter.post(
  '/:roomId',
  asyncHandler(async (req, res) => {
    const { enabled } = enabledSchema.parse(req.body);
    const out = await captionsService.setEnabled(
      authedUserId(req),
      String(req.params.roomId),
      enabled,
    );
    res.json(out);
  }),
);
