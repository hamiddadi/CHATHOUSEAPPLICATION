import { Router } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { requireAuth } from '../../middlewares/auth.middleware';
import { followController } from './follow.controller';

export const followRouter: Router = Router();

followRouter.use(requireAuth);

followRouter.get('/followers', asyncHandler(followController.followers));
followRouter.get('/following', asyncHandler(followController.following));
followRouter.post('/:userId', asyncHandler(followController.follow));
followRouter.delete('/:userId', asyncHandler(followController.unfollow));
