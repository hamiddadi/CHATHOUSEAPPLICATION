import type { Request, Response } from 'express';
import {
  requireAdmin,
  requireModerator,
  requirePrimarySession,
  requireSuperAdmin,
} from '../src/middlewares/auth.middleware';
import { AppError } from '../src/middlewares/error.middleware';

describe('admin primary-session guard', () => {
  it('rejects a request authenticated with an impersonation bearer', () => {
    const next = jest.fn();

    requirePrimarySession(
      { userId: 'target-1', impersonatorId: 'admin-1' } as Request,
      {} as Response,
      next,
    );

    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0]?.[0]).toBeInstanceOf(AppError);
    expect(next.mock.calls[0]?.[0]).toMatchObject({ code: 'AUTH_008', status: 403 });
  });

  it('accepts an authenticated primary session', () => {
    const next = jest.fn();

    requirePrimarySession({ userId: 'admin-1' } as Request, {} as Response, next);

    expect(next).toHaveBeenCalledWith();
  });

  it.each([
    ['moderator', requireModerator],
    ['admin', requireAdmin],
    ['super-admin', requireSuperAdmin],
  ] as const)('rejects an impersonation bearer at the %s role gate', async (_name, guard) => {
    const next = jest.fn();

    await guard(
      {
        userId: 'target-1',
        impersonatorId: 'admin-1',
        appRole: 'SUPER_ADMIN',
      } as Request,
      {} as Response,
      next,
    );

    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0]?.[0]).toBeInstanceOf(AppError);
    expect(next.mock.calls[0]?.[0]).toMatchObject({ code: 'AUTH_008', status: 403 });
  });
});
