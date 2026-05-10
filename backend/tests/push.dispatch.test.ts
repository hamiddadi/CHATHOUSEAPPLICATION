/**
 * Unit tests for the real Expo-push dispatch path. Mocks global fetch
 * to exercise the dead-token pruning + error handling without calling
 * the live Expo endpoint.
 */
process.env.DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://chathouse:chathouse@localhost:5433/chathouse?schema=public';
process.env.REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
process.env.PUSH_DISPATCH_ENABLED = 'true';

/* eslint-disable @typescript-eslint/no-require-imports */
const { prisma } = require('../src/config/database') as typeof import('../src/config/database');
const { pushService } =
  require('../src/modules/push/push.service') as typeof import('../src/modules/push/push.service');
/* eslint-enable @typescript-eslint/no-require-imports */

const rand = () => Math.random().toString(36).slice(2, 10);

describe('pushService.dispatchToUser — real Expo path (mocked fetch)', () => {
  const createdUserIds: string[] = [];
  let fetchSpy: jest.SpyInstance;

  afterEach(() => {
    fetchSpy?.mockRestore();
  });

  afterAll(async () => {
    for (const id of createdUserIds) {
      await prisma.user.delete({ where: { id } }).catch(() => undefined);
    }
    await prisma.$disconnect();
  });

  const seedUserWithToken = async (token: string) => {
    const user = await prisma.user.create({
      data: {
        username: `push_${rand()}`,
        email: `push_${rand()}@test.local`,
      },
    });
    createdUserIds.push(user.id);
    await prisma.pushToken.create({
      data: { userId: user.id, token, platform: 'expo' },
    });
    return user;
  };

  it('POSTs messages to Expo and survives a 5xx without throwing', async () => {
    const user = await seedUserWithToken(`ExponentPushToken[${rand()}]`);

    fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(new Response('boom', { status: 503 }));

    await expect(
      pushService.dispatchToUser(user.id, { title: 't', body: 'b' }),
    ).resolves.toBeUndefined();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('prunes tokens Expo flags as DeviceNotRegistered', async () => {
    const deadToken = `ExponentPushToken[${rand()}]`;
    const user = await seedUserWithToken(deadToken);

    fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            {
              status: 'error',
              message: 'not registered',
              details: { error: 'DeviceNotRegistered' },
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    await pushService.dispatchToUser(user.id, { title: 't', body: 'b' });

    const remaining = await prisma.pushToken.findMany({
      where: { token: deadToken },
    });
    expect(remaining).toHaveLength(0);
  });

  it('keeps tokens when Expo returns ok tickets', async () => {
    const liveToken = `ExponentPushToken[${rand()}]`;
    const user = await seedUserWithToken(liveToken);

    fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: [{ status: 'ok', id: 'receipt-1' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    await pushService.dispatchToUser(user.id, { title: 't', body: 'b' });

    const remaining = await prisma.pushToken.findMany({
      where: { token: liveToken },
    });
    expect(remaining).toHaveLength(1);
  });

  it('no-ops when the user has no registered tokens (no fetch)', async () => {
    const user = await prisma.user.create({
      data: { username: `notok_${rand()}`, email: `notok_${rand()}@test.local` },
    });
    createdUserIds.push(user.id);

    fetchSpy = jest.spyOn(global, 'fetch');

    await pushService.dispatchToUser(user.id, { title: 't', body: 'b' });

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
