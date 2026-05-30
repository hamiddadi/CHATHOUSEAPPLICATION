import { Router } from 'express';
import { requireAuth } from '../../../middlewares/auth.middleware';
import { asyncHandler } from '../../../utils/asyncHandler';
import { authedUserId } from '../../../utils/authedUserId';
import { calendarService } from './calendar.service';

export const calendarRouter: Router = Router();

calendarRouter.use(requireAuth);

calendarRouter.get(
  '/:roomId.ics',
  asyncHandler(async (req, res) => {
    const ics = await calendarService.icsForRoom(authedUserId(req), String(req.params.roomId));
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="chathouse-${String(req.params.roomId)}.ics"`,
    );
    res.send(ics);
  }),
);
