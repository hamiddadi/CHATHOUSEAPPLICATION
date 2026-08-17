import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { ZodError, z } from 'zod';
import {
  AppError,
  ERROR_CODES,
  errorMiddleware,
  notFoundHandler,
} from '../src/middlewares/error.middleware';
import { asyncHandler } from '../src/utils/asyncHandler';
import { logger } from '../src/config/logger';
import { REDACTED_URL_CAPABILITY } from '../src/utils/sanitizeRequestUrl';

const buildApp = (handler: express.RequestHandler): express.Express => {
  const app = express();
  app.get('/boom', handler);
  app.use(notFoundHandler);
  app.use(errorMiddleware);
  return app;
};

describe('AppError', () => {
  it('carries the HTTP status declared in ERROR_CODES', () => {
    const err = new AppError('AUTH_001');
    expect(err.status).toBe(ERROR_CODES.AUTH_001.status);
    expect(err.code).toBe('AUTH_001');
    expect(err.message).toBe(ERROR_CODES.AUTH_001.message);
  });

  it('accepts a custom message', () => {
    const err = new AppError('ROOM_001', 'room abc not found');
    expect(err.message).toBe('room abc not found');
  });
});

describe('errorMiddleware', () => {
  it('maps AppError to its declared status and code', async () => {
    const app = buildApp(() => {
      throw new AppError('USER_001');
    });
    const res = await request(app).get('/boom');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      success: false,
      error: expect.objectContaining({ code: 'USER_001', message: 'User not found' }),
    });
  });

  it('maps ZodError to VALIDATION_001 with field details', async () => {
    const app = buildApp(
      asyncHandler(async () => {
        await z.object({ foo: z.string() }).parseAsync({});
        throw new Error('unreachable');
      }),
    );
    const res = await request(app).get('/boom');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_001');
  });

  it('maps TokenExpiredError to AUTH_002', async () => {
    const app = buildApp(() => {
      throw new jwt.TokenExpiredError('jwt expired', new Date());
    });
    const res = await request(app).get('/boom');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('AUTH_002');
  });

  it('catches generic errors as SERVER_001', async () => {
    const app = buildApp(() => {
      throw new Error('boom');
    });
    const res = await request(app).get('/boom');
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('SERVER_001');
  });

  it('delegates failures after streaming headers have already been sent', () => {
    const error = new Error('stream database failure');
    const next = jest.fn();
    const status = jest.fn();
    const json = jest.fn();

    errorMiddleware(
      error,
      { method: 'GET', originalUrl: '/api/users/me/export' } as express.Request,
      { headersSent: true, status, json } as unknown as express.Response,
      next,
    );

    expect(next).toHaveBeenCalledWith(error);
    expect(status).not.toHaveBeenCalled();
    expect(json).not.toHaveBeenCalled();
  });

  it('redacts a private-media capability and query string from error logs', async () => {
    const signature = 's'.repeat(43);
    const logSpy = jest.spyOn(logger, 'error').mockImplementation(() => logger);
    const app = express();
    app.get('/media/:id/:signature', () => {
      throw new Error('storage unavailable');
    });
    app.use(errorMiddleware);

    const res = await request(app).get(`/media/object-1/${signature}?download=secret`);

    expect(res.status).toBe(500);
    const logged = JSON.stringify(logSpy.mock.calls);
    expect(logged).toContain(`/media/object-1/${REDACTED_URL_CAPABILITY}`);
    expect(logged).not.toContain(signature);
    expect(logged).not.toContain('download=secret');
    logSpy.mockRestore();
  });

  it('notFoundHandler returns NOT_FOUND_001', async () => {
    const app = buildApp((_req, res) => {
      res.json({ ok: true });
    });
    const res = await request(app).get('/no-such-path');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND_001');
  });

  // Avoid unused import warning when jest filter skips preceding test
  expect(ZodError).toBeDefined();
});
