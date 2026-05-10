import { Router } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { requireAuth } from '../../middlewares/auth.middleware';
import { exploreController } from './explore.controller';

export const exploreRouter: Router = Router();

exploreRouter.use(requireAuth);
exploreRouter.get('/', asyncHandler(exploreController.feed));
