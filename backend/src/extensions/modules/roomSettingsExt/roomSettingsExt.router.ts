import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../../middlewares/auth.middleware';
import { asyncHandler } from '../../../utils/asyncHandler';
import { authedUserId } from '../../../utils/authedUserId';
import { roomSettingsExtService } from './roomSettingsExt.service';

export const roomSettingsExtRouter: Router = Router();

roomSettingsExtRouter.use(requireAuth);

const handRaiseSchema = z.object({
  restriction: z.enum(['everyone', 'followers', 'none']),
});

roomSettingsExtRouter.get(
  '/:roomId',
  asyncHandler(async (req, res) => {
    const roomId = String(req.params.roomId);
    const settings = await roomSettingsExtService.getForParticipant(roomId, authedUserId(req));
    res.json(settings);
  }),
);

roomSettingsExtRouter.patch(
  '/:roomId/hand-raise',
  asyncHandler(async (req, res) => {
    const { restriction } = handRaiseSchema.parse(req.body);
    const next = await roomSettingsExtService.setHandRaise(
      String(req.params.roomId),
      authedUserId(req),
      restriction,
    );
    res.json(next);
  }),
);

roomSettingsExtRouter.post(
  '/:roomId/co-hosts/:userId',
  asyncHandler(async (req, res) => {
    const next = await roomSettingsExtService.addCoHost(
      String(req.params.roomId),
      authedUserId(req),
      String(req.params.userId),
    );
    res.json(next);
  }),
);

roomSettingsExtRouter.delete(
  '/:roomId/co-hosts/:userId',
  asyncHandler(async (req, res) => {
    const next = await roomSettingsExtService.removeCoHost(
      String(req.params.roomId),
      authedUserId(req),
      String(req.params.userId),
    );
    res.json(next);
  }),
);
