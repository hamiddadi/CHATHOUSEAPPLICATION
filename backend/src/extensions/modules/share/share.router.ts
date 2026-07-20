import { Router } from 'express';
import { requireAuth } from '../../../middlewares/auth.middleware';
import { asyncHandler } from '../../../utils/asyncHandler';
import { authedUserId } from '../../../utils/authedUserId';
import { shareService } from './share.service';

export const shareRouter: Router = Router();

shareRouter.use(requireAuth);

shareRouter.get(
  '/rooms/:roomId',
  asyncHandler(async (req, res) => {
    const links = await shareService.roomShare(authedUserId(req), String(req.params.roomId));
    res.json(links);
  }),
);
