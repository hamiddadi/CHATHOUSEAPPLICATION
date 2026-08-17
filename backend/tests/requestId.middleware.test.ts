import type { NextFunction, Request, Response } from 'express';
import { requestIdMiddleware } from '../src/middlewares/requestId.middleware';

const invoke = (incoming?: string | string[]) => {
  const header = Array.isArray(incoming) ? incoming.join(', ') : incoming;
  const req = {
    get: jest.fn().mockReturnValue(header),
  } as unknown as Request;
  const setHeader = jest.fn();
  const res = { setHeader } as unknown as Response;
  const next = jest.fn() as NextFunction;

  requestIdMiddleware(req, res, next);
  return { req, setHeader, next };
};

describe('requestIdMiddleware', () => {
  it('propagates a bounded safe request id to the response', () => {
    const result = invoke('mobile-client:request_123');

    expect(result.req.requestId).toBe('mobile-client:request_123');
    expect(result.setHeader).toHaveBeenCalledWith('X-Request-ID', 'mobile-client:request_123');
    expect(result.next).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['too short', 'short'],
    ['contains control characters', 'request-id\r\ninjected: true'],
    ['is repeated', ['safe-request-id', 'second-request-id']],
  ])('replaces an unsafe id when it %s', (_label, incoming) => {
    const result = invoke(incoming);

    expect(result.req.requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(result.setHeader).toHaveBeenCalledWith('X-Request-ID', result.req.requestId);
    expect(result.next).toHaveBeenCalledTimes(1);
  });
});
