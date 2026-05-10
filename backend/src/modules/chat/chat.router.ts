import { Router } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { requireAuth } from '../../middlewares/auth.middleware';
import { chatController } from './chat.controller';

export const chatRouter: Router = Router();

chatRouter.use(requireAuth);

// Unread count + conversations list live at the root — no collision with
// the peer-id catch-all below because Express matches literal paths first.
chatRouter.get('/conversations', asyncHandler(chatController.conversations));
chatRouter.get('/unread-count', asyncHandler(chatController.unreadCount));

// Per-message operations (mark-read, delete) live under /messages so the
// route shape is unambiguous.
chatRouter.patch('/messages/:messageId/read', asyncHandler(chatController.markRead));
chatRouter.delete('/messages/:messageId', asyncHandler(chatController.remove));

// Peer-scoped thread operations.
chatRouter.get('/:userId', asyncHandler(chatController.withPeer));
chatRouter.post('/:userId', asyncHandler(chatController.send));
chatRouter.patch('/:userId/read', asyncHandler(chatController.markReadWithPeer));
