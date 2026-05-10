import { Router } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { requireAuth } from '../../middlewares/auth.middleware';
import { pushController } from './push.controller';

export const pushRouter: Router = Router();
pushRouter.use(requireAuth);

pushRouter.post('/register', asyncHandler(pushController.register));
pushRouter.post('/unregister', asyncHandler(pushController.unregister));
