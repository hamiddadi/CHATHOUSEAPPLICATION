import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../../middlewares/auth.middleware';
import { asyncHandler } from '../../../utils/asyncHandler';
import { authedUserId } from '../../../utils/authedUserId';
import { extEventsService } from './events.service';

export const eventsRouter: Router = Router();

eventsRouter.use(requireAuth);

const cancelSchema = z.object({
  reason: z.string().trim().min(1).max(280).optional(),
});

eventsRouter.post(
  '/:id/cancel',
  asyncHandler(async (req, res) => {
    const { reason } = cancelSchema.parse(req.body ?? {});
    const userId = authedUserId(req);
    const roomId = String(req.params.id);
    const result = await extEventsService.cancel(userId, roomId, reason);
    res.json({ canceled: true, ...result });
  }),
);

const rescheduleSchema = z.object({
  scheduledFor: z.string().datetime(),
  title: z.string().trim().min(3).max(120).optional(),
});

eventsRouter.patch(
  '/:id/reschedule',
  asyncHandler(async (req, res) => {
    const input = rescheduleSchema.parse(req.body ?? {});
    const userId = authedUserId(req);
    const roomId = String(req.params.id);
    const result = await extEventsService.reschedule(userId, roomId, {
      scheduledFor: new Date(input.scheduledFor),
      title: input.title,
    });
    res.json(result);
  }),
);
