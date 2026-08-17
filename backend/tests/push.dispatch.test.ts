/**
 * Unit tests for the FCM dispatch path (de-Expo: replaced the Expo exp.host
 * fetch). Mocks firebase-admin so dispatchToUser exercises
 * sendEachForMulticast + dead-token pruning without real credentials/network.
 */
process.env.DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://chathouse:chathouse@localhost:5433/chathouse?schema=public';
process.env.REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
const originalPushDispatchEnabled = process.env.PUSH_DISPATCH_ENABLED;
process.env.PUSH_DISPATCH_ENABLED = 'true';

// Pretend a Firebase app is already initialised so getMessagingClient() skips
// credential init and goes straight to getMessaging().
jest.mock('firebase-admin', () => ({
  applicationDefault: jest.fn(),
  getApps: () => [{}],
  initializeApp: jest.fn(),
  cert: jest.fn(),
}));
// `mock`-prefixed name is allowed inside the hoisted jest.mock factory.
const mockSendEachForMulticast = jest.fn();
jest.mock('firebase-admin/messaging', () => ({
  getMessaging: () => ({ sendEachForMulticast: mockSendEachForMulticast }),
}));

/* eslint-disable @typescript-eslint/no-require-imports */
const { prisma } = require('../src/config/database') as typeof import('../src/config/database');
const { pushService } =
  require('../src/modules/push/push.service') as typeof import('../src/modules/push/push.service');
/* eslint-enable @typescript-eslint/no-require-imports */

const rand = () => Math.random().toString(36).slice(2, 10);

const okBatch = (n: number) => ({
  successCount: n,
  failureCount: 0,
  responses: Array.from({ length: n }, (_, i) => ({ success: true, messageId: `m${i}` })),
});

describe('pushService.dispatchToUser — FCM path (mocked firebase-admin)', () => {
  const createdUserIds: string[] = [];

  afterEach(() => {
    mockSendEachForMulticast.mockReset();
  });

  afterAll(async () => {
    for (const id of createdUserIds) {
      await prisma.user.delete({ where: { id } }).catch(() => undefined);
    }
    await prisma.$disconnect();
    if (originalPushDispatchEnabled === undefined) {
      delete process.env.PUSH_DISPATCH_ENABLED;
    } else {
      process.env.PUSH_DISPATCH_ENABLED = originalPushDispatchEnabled;
    }
  });

  const seedUserWithToken = async (token: string) => {
    const user = await prisma.user.create({
      data: { username: `push_${rand()}`, email: `push_${rand()}@test.local` },
    });
    createdUserIds.push(user.id);
    await prisma.pushToken.create({ data: { userId: user.id, token, platform: 'android' } });
    return user;
  };

  it('rejects explicitly when the FCM transport fails', async () => {
    const user = await seedUserWithToken(`fcm_${rand()}`);
    mockSendEachForMulticast.mockRejectedValue(new Error('boom'));

    await expect(pushService.dispatchToUser(user.id, { title: 't', body: 'b' })).rejects.toThrow(
      'boom',
    );

    expect(mockSendEachForMulticast).toHaveBeenCalledTimes(1);
  });

  it('prunes tokens FCM flags as registration-token-not-registered', async () => {
    const deadToken = `fcm_${rand()}`;
    const user = await seedUserWithToken(deadToken);

    mockSendEachForMulticast.mockResolvedValue({
      successCount: 0,
      failureCount: 1,
      responses: [
        {
          success: false,
          error: { code: 'messaging/registration-token-not-registered', message: 'gone' },
        },
      ],
    });

    await pushService.dispatchToUser(user.id, { title: 't', body: 'b' });

    const remaining = await prisma.pushToken.findMany({ where: { token: deadToken } });
    expect(remaining).toHaveLength(0);
  });

  it('surfaces a resolved batch with transient per-token failures for outbox retry', async () => {
    const liveToken = `fcm_${rand()}`;
    const user = await seedUserWithToken(liveToken);
    mockSendEachForMulticast.mockResolvedValue({
      successCount: 0,
      failureCount: 1,
      responses: [
        {
          success: false,
          error: { code: 'messaging/internal-error', message: 'provider unavailable' },
        },
      ],
    });

    await expect(pushService.dispatchToUser(user.id, { title: 't', body: 'b' })).rejects.toThrow(
      'messaging/internal-error',
    );
    expect(await prisma.pushToken.count({ where: { token: liveToken } })).toBe(1);
  });

  it('does not prune an ambiguous invalid-argument response', async () => {
    const liveToken = `fcm_${rand()}`;
    const user = await seedUserWithToken(liveToken);
    mockSendEachForMulticast.mockResolvedValue({
      successCount: 0,
      failureCount: 1,
      responses: [
        {
          success: false,
          error: { code: 'messaging/invalid-argument', message: 'bad payload or token' },
        },
      ],
    });

    await expect(pushService.dispatchToUser(user.id, { title: 't', body: 'b' })).rejects.toThrow(
      'messaging/invalid-argument',
    );
    expect(await prisma.pushToken.count({ where: { token: liveToken } })).toBe(1);
  });

  it('keeps tokens on a successful send', async () => {
    const liveToken = `fcm_${rand()}`;
    const user = await seedUserWithToken(liveToken);

    mockSendEachForMulticast.mockResolvedValue(okBatch(1));

    await pushService.dispatchToUser(user.id, { title: 't', body: 'b' });

    const remaining = await prisma.pushToken.findMany({ where: { token: liveToken } });
    expect(remaining).toHaveLength(1);
  });

  it('sets Android/APNs collapse identifiers from the stable notification id', async () => {
    const user = await seedUserWithToken(`fcm_${rand()}`);
    mockSendEachForMulticast.mockResolvedValue(okBatch(1));

    await pushService.dispatchToUser(user.id, {
      title: 't',
      body: 'b',
      data: { notificationId: 'notification-stable-id' },
    });

    expect(mockSendEachForMulticast).toHaveBeenCalledWith(
      expect.objectContaining({
        android: expect.objectContaining({ collapseKey: 'notification-stable-id' }),
        apns: { headers: { 'apns-collapse-id': 'notification-stable-id' } },
      }),
    );
  });

  it('no-ops when the user has no registered tokens (no send)', async () => {
    const user = await prisma.user.create({
      data: { username: `notok_${rand()}`, email: `notok_${rand()}@test.local` },
    });
    createdUserIds.push(user.id);

    await pushService.dispatchToUser(user.id, { title: 't', body: 'b' });

    expect(mockSendEachForMulticast).not.toHaveBeenCalled();
  });
});
