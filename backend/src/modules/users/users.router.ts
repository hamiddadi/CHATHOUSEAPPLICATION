import { Router } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { requireAuth } from '../../middlewares/auth.middleware';
import { socialController } from '../social/social.controller';
import { followController } from '../follow/follow.controller';
import { usersController } from './users.controller';

export const usersRouter: Router = Router();

// All user endpoints require a valid access token.
usersRouter.use(requireAuth);

usersRouter.get('/me', asyncHandler(usersController.getMe));
usersRouter.patch('/me', asyncHandler(usersController.updateMe));
usersRouter.patch('/me/username', asyncHandler(usersController.setUsername));
usersRouter.patch('/me/visibility', asyncHandler(usersController.setVisibility));
usersRouter.patch('/me/location', asyncHandler(usersController.setLocation));
usersRouter.patch('/me/interests', asyncHandler(usersController.setInterests));
usersRouter.patch('/me/onboarding', asyncHandler(usersController.completeOnboarding));
usersRouter.get('/me/blocked', asyncHandler(socialController.listBlocked));
usersRouter.get('/me/notification-preferences', asyncHandler(usersController.getNotifPrefs));
usersRouter.patch('/me/notification-preferences', asyncHandler(usersController.updateNotifPrefs));
usersRouter.post('/me/request-deletion', asyncHandler(usersController.requestDeletion));
usersRouter.post('/me/cancel-deletion', asyncHandler(usersController.cancelDeletion));
// GDPR Article 20 — data portability. Returns a JSON archive of every
// piece of user-owned content the platform holds.
usersRouter.get('/me/export', asyncHandler(usersController.exportData));
usersRouter.get('/online-locations', asyncHandler(usersController.onlineLocations));
usersRouter.get('/check-username', asyncHandler(usersController.checkUsername));
usersRouter.get('/suggest-username', asyncHandler(usersController.suggestUsername));
usersRouter.get('/search', asyncHandler(usersController.search));
usersRouter.get('/:id', asyncHandler(usersController.getById));
usersRouter.get('/:id/mutual-followers', asyncHandler(followController.mutualFollowers));

// Social actions on another user — wave / block / report.
usersRouter.post('/:id/wave', asyncHandler(socialController.wave));
usersRouter.post('/:id/block', asyncHandler(socialController.block));
usersRouter.delete('/:id/block', asyncHandler(socialController.unblock));
usersRouter.post('/:id/report', asyncHandler(socialController.report));
// NOTE: pinging a user to a room lives on the rooms router as
// POST /rooms/:id/ping/:userId (both ids in the path). A former
// /users/:userId/ping alias was removed — it was wired to the shared ping
// controller, which reads the room id from params.id, a param this route
// never provided, so it always 404'd.
