import { Router } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { requireAuth } from '../../middlewares/auth.middleware';
import { recordingsController } from './recordings.controller';

export const recordingsRouter: Router = Router();

recordingsRouter.use(requireAuth);

// Recent public replays (feed) + a single room's completed replays.
recordingsRouter.get('/', asyncHandler(recordingsController.recent));
recordingsRouter.get('/room/:roomId', asyncHandler(recordingsController.forRoom));
// A user's published public replays (rooms they hosted) — for their profile.
recordingsRouter.get('/users/:userId', asyncHandler(recordingsController.forHost));
