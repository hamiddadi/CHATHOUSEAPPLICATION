import { Router } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { requireAuth } from '../../middlewares/auth.middleware';
import { groupsController } from './groups.controller';

export const groupsRouter: Router = Router();

groupsRouter.use(requireAuth);

// Collection: list my groups + create a new one.
groupsRouter.get('/', asyncHandler(groupsController.list));
groupsRouter.post('/', asyncHandler(groupsController.create));

// Per-conversation operations.
groupsRouter.get('/:id', asyncHandler(groupsController.detail));
groupsRouter.get('/:id/messages', asyncHandler(groupsController.messages));
groupsRouter.post('/:id/messages', asyncHandler(groupsController.send));
groupsRouter.patch('/:id/read', asyncHandler(groupsController.markRead));
groupsRouter.post('/:id/members', asyncHandler(groupsController.addMembers));
groupsRouter.post('/:id/leave', asyncHandler(groupsController.leave));
