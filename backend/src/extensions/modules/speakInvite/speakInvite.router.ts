import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../../middlewares/auth.middleware';
import { asyncHandler } from '../../../utils/asyncHandler';
import { authedUserId } from '../../../utils/authedUserId';
import { speakInviteService } from './speakInvite.service';

export const speakInviteRouter: Router = Router();

speakInviteRouter.use(requireAuth);

const respondSchema = z.object({ accepted: z.boolean() });

speakInviteRouter.post(
  '/:roomId/invite/:userId',
  asyncHandler(async (req, res) => {
    const result = await speakInviteService.invite(
      String(req.params.roomId),
      authedUserId(req),
      String(req.params.userId),
    );
    res.status(201).json(result);
  }),
);

speakInviteRouter.post(
  '/:roomId/respond',
  asyncHandler(async (req, res) => {
    const { accepted } = respondSchema.parse(req.body ?? {});
    const result = await speakInviteService.respond(
      String(req.params.roomId),
      authedUserId(req),
      accepted,
    );
    res.json(result);
  }),
);

speakInviteRouter.post(
  '/:roomId/promote/:userId',
  asyncHandler(async (req, res) => {
    const result = await speakInviteService.promoteToModerator(
      String(req.params.roomId),
      authedUserId(req),
      String(req.params.userId),
    );
    res.json(result);
  }),
);
