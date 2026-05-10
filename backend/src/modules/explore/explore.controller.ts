import type { Request, Response } from 'express';
import { sendOk } from '../../utils/response';
import { AppError } from '../../middlewares/error.middleware';
import { exploreService } from './explore.service';

export const exploreController = {
  async feed(req: Request, res: Response) {
    if (!req.userId) throw new AppError('AUTH_003');
    const result = await exploreService.feed(req.userId);
    sendOk(res, result);
  },
};
