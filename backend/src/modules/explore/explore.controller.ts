import type { Request, Response } from 'express';
import { sendOk } from '../../utils/response';
import { authedUserId } from '../../utils/authedUserId';
import { exploreService } from './explore.service';

export const exploreController = {
  async feed(req: Request, res: Response) {
    const result = await exploreService.feed(authedUserId(req));
    sendOk(res, result);
  },
};
