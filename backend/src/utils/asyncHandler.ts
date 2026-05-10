import type { NextFunction, Request, RequestHandler, Response } from 'express';

/**
 * Wrap an async route handler so rejected promises are forwarded to the
 * Express error middleware instead of crashing the process as unhandled
 * rejections. Usage: `router.get('/x', asyncHandler(handler))`.
 */
export const asyncHandler =
  <Req extends Request = Request, Res extends Response = Response>(
    fn: (req: Req, res: Res, next: NextFunction) => Promise<unknown>,
  ): RequestHandler =>
  (req, res, next) => {
    Promise.resolve(fn(req as Req, res as Res, next)).catch(next);
  };
