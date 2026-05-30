import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../../middlewares/auth.middleware';
import { asyncHandler } from '../../../utils/asyncHandler';
import { authedUserId } from '../../../utils/authedUserId';
import { netqualityService } from './netquality.service';

export const netqualityRouter: Router = Router();

netqualityRouter.use(requireAuth);

const reportSchema = z.object({
  roomId: z.string().min(1).max(40),
  rttMs: z.number().min(0).max(60_000),
  jitterMs: z.number().min(0).max(60_000),
  packetLossPct: z.number().min(0).max(100),
});

netqualityRouter.post(
  '/report',
  asyncHandler(async (req, res) => {
    const { roomId, rttMs, jitterMs, packetLossPct } = reportSchema.parse(req.body);
    const result = await netqualityService.report(
      authedUserId(req),
      roomId,
      rttMs,
      jitterMs,
      packetLossPct,
    );
    res.json(result);
  }),
);

netqualityRouter.get(
  '/:roomId',
  asyncHandler(async (req, res) => {
    const result = await netqualityService.get(authedUserId(req), String(req.params.roomId));
    res.json(result ?? { bars: null, warning: null });
  }),
);
