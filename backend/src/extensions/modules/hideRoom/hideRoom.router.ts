import { Router } from 'express';
import { requireAuth } from '../../../middlewares/auth.middleware';
import { asyncHandler } from '../../../utils/asyncHandler';
import { authedUserId } from '../../../utils/authedUserId';
import { hideRoomService } from './hideRoom.service';

export const hideRoomRouter: Router = Router();

hideRoomRouter.use(requireAuth);

hideRoomRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    // Cleanup expired entries opportunistically on every list call
    await hideRoomService.cleanupExpired(authedUserId(req));
    const items = await hideRoomService.list(authedUserId(req));
    res.json({ items, count: items.length });
  }),
);

hideRoomRouter.post(
  '/:roomId',
  asyncHandler(async (req, res) => {
    await hideRoomService.hide(authedUserId(req), String(req.params.roomId));
    res.json({ hidden: true });
  }),
);

hideRoomRouter.delete(
  '/:roomId',
  asyncHandler(async (req, res) => {
    await hideRoomService.unhide(authedUserId(req), String(req.params.roomId));
    res.json({ hidden: false });
  }),
);
