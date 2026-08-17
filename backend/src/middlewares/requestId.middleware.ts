import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';

declare module 'express-serve-static-core' {
  interface Request {
    requestId?: string;
  }
}

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;

/** Attach a safe correlation id to the request, response and structured logs. */
export const requestIdMiddleware: RequestHandler = (req, res, next) => {
  const candidate = req.get('X-Request-ID')?.trim();
  req.requestId = candidate && REQUEST_ID_PATTERN.test(candidate) ? candidate : randomUUID();
  res.setHeader('X-Request-ID', req.requestId);
  next();
};
