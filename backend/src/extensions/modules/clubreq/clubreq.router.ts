import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../../middlewares/auth.middleware';
import { asyncHandler } from '../../../utils/asyncHandler';
import { authedUserId } from '../../../utils/authedUserId';
import { clubReqService } from './clubreq.service';

export const clubReqRouter: Router = Router();

clubReqRouter.use(requireAuth);

const requestSchema = z.object({
  message: z.string().trim().min(1).max(280).optional(),
});

clubReqRouter.post(
  '/:clubId/request',
  asyncHandler(async (req, res) => {
    const { message } = requestSchema.parse(req.body ?? {});
    const result = await clubReqService.request(
      authedUserId(req),
      String(req.params.clubId),
      message,
    );
    res.status(201).json(result);
  }),
);

clubReqRouter.get(
  '/:clubId/requests',
  asyncHandler(async (req, res) => {
    const items = await clubReqService.list(authedUserId(req), String(req.params.clubId));
    res.json({ items, count: items.length });
  }),
);

clubReqRouter.post(
  '/:clubId/requests/:userId/approve',
  asyncHandler(async (req, res) => {
    const result = await clubReqService.approve(
      authedUserId(req),
      String(req.params.clubId),
      String(req.params.userId),
    );
    res.json(result);
  }),
);

clubReqRouter.post(
  '/:clubId/requests/:userId/decline',
  asyncHandler(async (req, res) => {
    const result = await clubReqService.decline(
      authedUserId(req),
      String(req.params.clubId),
      String(req.params.userId),
    );
    res.json(result);
  }),
);
