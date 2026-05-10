import type { Request, Response } from 'express';
import { sendOk } from '../../utils/response';
import { AppError } from '../../middlewares/error.middleware';
import { searchSchema } from './search.schema';
import { searchService } from './search.service';

export const searchController = {
  async search(req: Request, res: Response) {
    if (!req.userId) throw new AppError('AUTH_003');
    const input = searchSchema.parse(req.query);
    const result = await searchService.search(input, req.userId);
    sendOk(res, result);
  },
};
