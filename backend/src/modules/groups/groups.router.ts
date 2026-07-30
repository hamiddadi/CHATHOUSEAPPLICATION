import { Router } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { requireAuth } from '../../middlewares/auth.middleware';
import { contentReportsController } from '../reports/contentReports.controller';
import { requireCurrentLegalAcceptance } from '../auth/legal-acceptance';
import { groupsController } from './groups.controller';

export const groupsRouter: Router = Router();

groupsRouter.use(requireAuth);

// Collection: list my groups + create a new one.
groupsRouter.get('/', asyncHandler(groupsController.list));
groupsRouter.post('/', requireCurrentLegalAcceptance, asyncHandler(groupsController.create));

// Per-conversation operations.
groupsRouter.get('/:id', asyncHandler(groupsController.detail));
groupsRouter.patch('/:id', requireCurrentLegalAcceptance, asyncHandler(groupsController.rename));
groupsRouter.get('/:id/messages', asyncHandler(groupsController.messages));
groupsRouter.post(
  '/:id/messages',
  requireCurrentLegalAcceptance,
  asyncHandler(groupsController.send),
);
groupsRouter.post(
  '/:id/messages/:messageId/report',
  asyncHandler(contentReportsController.groupMessage),
);
groupsRouter.post(
  '/:id/voice',
  requireCurrentLegalAcceptance,
  asyncHandler(groupsController.sendVoice),
);
groupsRouter.patch('/:id/read', asyncHandler(groupsController.markRead));
groupsRouter.post('/:id/members', asyncHandler(groupsController.addMembers));
groupsRouter.delete('/:id/members/:userId', asyncHandler(groupsController.removeMember));
groupsRouter.post('/:id/leave', asyncHandler(groupsController.leave));
