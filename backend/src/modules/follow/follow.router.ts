import { Router } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { requireAuth } from '../../middlewares/auth.middleware';
import { followController } from './follow.controller';

export const followRouter: Router = Router();

followRouter.use(requireAuth);

// Authenticated user's own lists.
followRouter.get('/followers', asyncHandler(followController.followers));
followRouter.get('/following', asyncHandler(followController.following));
// FOLL-01: my pending follow-request inbox (literal — before the `/:userId`
// matchers so it isn't captured as a userId).
followRouter.get('/requests', asyncHandler(followController.requests));
// Another user's lists (two-segment paths — no collision with the literals
// above or the single-segment POST/DELETE below).
followRouter.get('/:userId/followers', asyncHandler(followController.followersOf));
followRouter.get('/:userId/following', asyncHandler(followController.followingOf));
// FOLL-01: accept/reject a pending request from `:userId` (the requester).
followRouter.post('/:userId/accept', asyncHandler(followController.acceptRequest));
followRouter.post('/:userId/reject', asyncHandler(followController.rejectRequest));
followRouter.post('/:userId', asyncHandler(followController.follow));
followRouter.delete('/:userId', asyncHandler(followController.unfollow));
