import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../../middlewares/auth.middleware';
import { asyncHandler } from '../../../utils/asyncHandler';
import { authedUserId } from '../../../utils/authedUserId';
import { chatReactionsService } from './chatReactions.service';

export const chatReactionsRouter: Router = Router();

chatReactionsRouter.use(requireAuth);

const toggleSchema = z.object({ emoji: z.string().min(1).max(8) });

chatReactionsRouter.get(
  '/:messageId',
  asyncHandler(async (req, res) => {
    const map = await chatReactionsService.list(authedUserId(req), String(req.params.messageId));
    res.json({ reactions: map });
  }),
);

chatReactionsRouter.post(
  '/:messageId/toggle',
  asyncHandler(async (req, res) => {
    const { emoji } = toggleSchema.parse(req.body);
    const map = await chatReactionsService.toggle(
      authedUserId(req),
      String(req.params.messageId),
      emoji,
    );
    res.json({ reactions: map });
  }),
);
