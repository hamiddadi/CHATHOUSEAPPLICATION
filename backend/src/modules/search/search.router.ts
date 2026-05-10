import { Router } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { requireAuth } from '../../middlewares/auth.middleware';
import { searchController } from './search.controller';

export const searchRouter: Router = Router();

searchRouter.use(requireAuth);
searchRouter.get('/', asyncHandler(searchController.search));
