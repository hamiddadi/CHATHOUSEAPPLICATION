import { Router } from 'express';
import { requireAuth } from '../../../middlewares/auth.middleware';
import { asyncHandler } from '../../../utils/asyncHandler';
import { authedUserId } from '../../../utils/authedUserId';
import { chatmodService } from './chatmod.service';

export const chatmodRouter: Router = Router();

chatmodRouter.use(requireAuth);

chatmodRouter.delete(
  '/messages/:id',
  asyncHandler(async (req, res) => {
    const messageId = String(req.params.id);
    const result = await chatmodService.deleteMessage(authedUserId(req), messageId);
    res.json(result);
  }),
);
