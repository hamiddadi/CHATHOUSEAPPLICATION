import { Router } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { requireAuth } from '../../middlewares/auth.middleware';
import { clubsController } from './clubs.controller';

export const clubsRouter: Router = Router();

clubsRouter.use(requireAuth);

clubsRouter.get('/', asyncHandler(clubsController.list));
clubsRouter.post('/', asyncHandler(clubsController.create));
clubsRouter.get('/:id', asyncHandler(clubsController.get));
clubsRouter.patch('/:id', asyncHandler(clubsController.update));
clubsRouter.delete('/:id', asyncHandler(clubsController.remove));
clubsRouter.post('/:id/join', asyncHandler(clubsController.join));
clubsRouter.post('/:id/leave', asyncHandler(clubsController.leave));
clubsRouter.post('/:id/invite', asyncHandler(clubsController.invite));
clubsRouter.post('/:id/accept', asyncHandler(clubsController.accept));
