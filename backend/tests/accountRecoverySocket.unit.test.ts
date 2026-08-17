import type { Socket } from 'socket.io';

jest.mock('../src/config/redis', () => ({
  redis: {
    get: jest.fn(),
    setEx: jest.fn(),
  },
}));

jest.mock('../src/config/database', () => ({
  prisma: {
    user: { findUnique: jest.fn() },
  },
}));

import { redis } from '../src/config/redis';
import { socketAuth } from '../src/socket/socket.middleware';
import { signAccessToken } from '../src/utils/jwt';

describe('account-recovery socket admission', () => {
  it('rejects a recovery bearer before Redis or database admission checks', async () => {
    const token = signAccessToken('pending-user', 3, 'account_recovery');
    const socket = {
      handshake: { auth: { token }, headers: {} },
      data: {},
    } as unknown as Socket;
    const next = jest.fn<void, [Error?]>();

    await socketAuth(socket, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0]?.[0]?.message).toBe('ACCOUNT_RESTORATION_REQUIRED');
    expect(redis.get).not.toHaveBeenCalled();
    expect(socket.data).toEqual({});
  });
});
