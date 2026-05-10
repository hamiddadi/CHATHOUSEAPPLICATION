import type { Request, Response } from 'express';
import { sendOk } from '../../utils/response';
import { AppError } from '../../middlewares/error.middleware';
import { followService } from './follow.service';

const requireUserId = (req: Request): string => {
  if (!req.userId) throw new AppError('AUTH_003');
  return req.userId;
};

const targetId = (req: Request): string => {
  const raw = req.params['userId'];
  const id = Array.isArray(raw) ? raw[0] : raw;
  if (!id) throw new AppError('USER_001');
  return id;
};

export const followController = {
  async follow(req: Request, res: Response) {
    const result = await followService.follow(requireUserId(req), targetId(req));
    sendOk(res, result);
  },

  async unfollow(req: Request, res: Response) {
    const result = await followService.unfollow(requireUserId(req), targetId(req));
    sendOk(res, result);
  },

  async followers(req: Request, res: Response) {
    const limit =
      typeof req.query['limit'] === 'string' ? Math.min(50, Number(req.query['limit'])) : 50;
    const cursor = typeof req.query['cursor'] === 'string' ? req.query['cursor'] : undefined;
    const result = await followService.listFollowers(requireUserId(req), limit, cursor);
    sendOk(res, result);
  },

  async following(req: Request, res: Response) {
    const limit =
      typeof req.query['limit'] === 'string' ? Math.min(50, Number(req.query['limit'])) : 50;
    const cursor = typeof req.query['cursor'] === 'string' ? req.query['cursor'] : undefined;
    const result = await followService.listFollowing(requireUserId(req), limit, cursor);
    sendOk(res, result);
  },

  async mutualFollowers(req: Request, res: Response) {
    const raw = req.params['id'];
    const id = Array.isArray(raw) ? raw[0] : raw;
    if (!id) throw new AppError('USER_001');
    const result = await followService.mutualFollowers(requireUserId(req), id);
    sendOk(res, result);
  },
};
