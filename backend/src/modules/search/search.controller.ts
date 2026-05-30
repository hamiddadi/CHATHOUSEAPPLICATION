import type { Request, Response } from 'express';
import { sendOk } from '../../utils/response';
import { authedUserId } from '../../utils/authedUserId';
import { searchSchema } from './search.schema';
import { searchService } from './search.service';

export const searchController = {
  async search(req: Request, res: Response) {
    const input = searchSchema.parse(req.query);
    const result = await searchService.search(input, authedUserId(req));
    sendOk(res, result);
  },
};
