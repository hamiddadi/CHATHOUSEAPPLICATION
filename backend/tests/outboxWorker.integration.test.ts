process.env.DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://chathouse:chathouse@localhost:5433/chathouse?schema=public';

export {};

/* eslint-disable @typescript-eslint/no-require-imports */
const { prisma } = require('../src/config/database') as typeof import('../src/config/database');
const { cleanupDeliveredOutboxEvents, processOutboxBatch, registerOutboxHandler } =
  require('../src/workers/outbox.worker') as typeof import('../src/workers/outbox.worker');
/* eslint-enable @typescript-eslint/no-require-imports */

const topic = (suffix: string) => `test.outbox.${suffix}.${Math.random().toString(36).slice(2)}`;

describe('transactional outbox worker', () => {
  const topics: string[] = [];

  afterEach(async () => {
    await prisma.outboxEvent.deleteMany({ where: { topic: { in: topics } } });
    topics.length = 0;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('recovers an expired PROCESSING lease but does not steal a fresh claim', async () => {
    const testTopic = topic('lease');
    topics.push(testTopic);
    const handled: string[] = [];
    const unregister = registerOutboxHandler(testTopic, async event => {
      handled.push(event.eventKey);
    });
    const now = Date.now();
    try {
      const [expired, fresh, pending] = await Promise.all([
        prisma.outboxEvent.create({
          data: {
            eventKey: `${testTopic}:expired`,
            topic: testTopic,
            payload: { notificationId: 'expired' },
            status: 'PROCESSING',
            attempts: 1,
            availableAt: new Date(now - 60_000),
            claimedAt: new Date(now - 60_000),
          },
        }),
        prisma.outboxEvent.create({
          data: {
            eventKey: `${testTopic}:fresh`,
            topic: testTopic,
            payload: { notificationId: 'fresh' },
            status: 'PROCESSING',
            attempts: 1,
            availableAt: new Date(now - 60_000),
            claimedAt: new Date(now),
          },
        }),
        prisma.outboxEvent.create({
          data: {
            eventKey: `${testTopic}:pending`,
            topic: testTopic,
            payload: { notificationId: 'pending' },
            availableAt: new Date(now - 60_000),
          },
        }),
      ]);

      expect(await processOutboxBatch({ topic: testTopic, leaseMs: 30_000 })).toBe(2);
      expect(handled.sort()).toEqual([expired.eventKey, pending.eventKey].sort());
      expect(await prisma.outboxEvent.findUniqueOrThrow({ where: { id: expired.id } })).toEqual(
        expect.objectContaining({ status: 'DELIVERED', attempts: 2, claimedAt: null }),
      );
      expect(await prisma.outboxEvent.findUniqueOrThrow({ where: { id: fresh.id } })).toEqual(
        expect.objectContaining({ status: 'PROCESSING', attempts: 1 }),
      );
    } finally {
      unregister();
    }
  });

  it('uses SKIP LOCKED so concurrent pollers invoke one handler once', async () => {
    const testTopic = topic('concurrency');
    topics.push(testTopic);
    let signalStarted!: () => void;
    let releaseHandler!: () => void;
    const started = new Promise<void>(resolve => (signalStarted = resolve));
    const gate = new Promise<void>(resolve => (releaseHandler = resolve));
    const handler = jest.fn(async () => {
      signalStarted();
      await gate;
    });
    const unregister = registerOutboxHandler(testTopic, handler);
    try {
      await prisma.outboxEvent.create({
        data: {
          eventKey: `${testTopic}:only`,
          topic: testTopic,
          aggregateId: 'aggregate-1',
          payload: { notificationId: 'only' },
        },
      });
      const firstPoll = processOutboxBatch({ topic: testTopic });
      await started;
      expect(await processOutboxBatch({ topic: testTopic })).toBe(0);
      releaseHandler();
      expect(await firstPoll).toBe(1);
      expect(handler).toHaveBeenCalledTimes(1);
    } finally {
      releaseHandler();
      unregister();
    }
  });

  it('times out a stuck handler and continues with the next event', async () => {
    const testTopic = topic('deadline');
    topics.push(testTopic);
    let stalledId = '';
    const handled: string[] = [];
    const unregister = registerOutboxHandler(testTopic, async event => {
      if (event.id === stalledId) await new Promise<void>(() => undefined);
      handled.push(event.id);
    });
    try {
      const stalled = await prisma.outboxEvent.create({
        data: {
          eventKey: `${testTopic}:stalled`,
          topic: testTopic,
          payload: { notificationId: 'stalled' },
          availableAt: new Date(Date.now() - 1_000),
        },
      });
      stalledId = stalled.id;
      const following = await prisma.outboxEvent.create({
        data: {
          eventKey: `${testTopic}:following`,
          topic: testTopic,
          payload: { notificationId: 'following' },
        },
      });

      expect(
        await processOutboxBatch({ topic: testTopic, batchSize: 1, handlerTimeoutMs: 50 }),
      ).toBe(1);
      expect(await prisma.outboxEvent.findUniqueOrThrow({ where: { id: stalled.id } })).toEqual(
        expect.objectContaining({
          status: 'PENDING',
          attempts: 1,
          deliveredAt: null,
          lastError: 'OutboxHandlerTimeout',
        }),
      );

      expect(
        await processOutboxBatch({ topic: testTopic, batchSize: 1, handlerTimeoutMs: 50 }),
      ).toBe(1);
      expect(handled).toEqual([following.id]);
      expect(await prisma.outboxEvent.findUniqueOrThrow({ where: { id: following.id } })).toEqual(
        expect.objectContaining({ status: 'DELIVERED', attempts: 1 }),
      );
    } finally {
      unregister();
    }
  });

  it('purges only delivered events older than the retention cutoff', async () => {
    const testTopic = topic('retention');
    topics.push(testTopic);
    const old = new Date(Date.now() - 10_000);
    const [expired, recent] = await Promise.all([
      prisma.outboxEvent.create({
        data: {
          eventKey: `${testTopic}:expired`,
          topic: testTopic,
          payload: { notificationId: 'expired' },
          status: 'DELIVERED',
          deliveredAt: old,
        },
      }),
      prisma.outboxEvent.create({
        data: {
          eventKey: `${testTopic}:recent`,
          topic: testTopic,
          payload: { notificationId: 'recent' },
          status: 'DELIVERED',
          deliveredAt: new Date(),
        },
      }),
    ]);

    expect(await cleanupDeliveredOutboxEvents(1_000)).toBeGreaterThanOrEqual(1);
    expect(await prisma.outboxEvent.findUnique({ where: { id: expired.id } })).toBeNull();
    expect(await prisma.outboxEvent.findUnique({ where: { id: recent.id } })).not.toBeNull();
  });
});
