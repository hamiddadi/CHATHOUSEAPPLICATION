import type { Response } from 'express';

export interface ApiSuccess<T> {
  success: true;
  data: T;
}

export interface ApiError {
  success: false;
  error: { code: string; message: string; details?: unknown };
}

export const sendOk = <T>(res: Response, data: T, status = 200): Response =>
  res.status(status).json({ success: true, data } satisfies ApiSuccess<T>);

export const sendError = (
  res: Response,
  code: string,
  message: string,
  status = 400,
  details?: unknown,
): Response =>
  res.status(status).json({
    success: false,
    error: { code, message, ...(details !== undefined ? { details } : {}) },
  } satisfies ApiError);
