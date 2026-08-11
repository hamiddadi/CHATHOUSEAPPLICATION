import { Prisma, type OutboxEvent } from '@prisma/client';
import { prisma } from '../config/database';
import { logger } from '../config/logger';
import {
  outboxBacklogGauge,
  outboxEventsTotal,
  outboxOldestPendingAgeSecondsGauge,
} from '../monitoring/metrics';

export type OutboxHandler = (event: OutboxEvent) => Promise<void>;

const handlers = new Map<string, OutboxHandler>();
const DEFAULT_BATCH_SIZE = 25;
export const OUTBOX_LEASE_MS = 30_000;
export const OUTBOX_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
export const OUTBOX_HANDLER_TIMEOUT_MS = 20_000;
const POLL_INTERVAL_MS = 500;
const CLEANUP_EVERY_POLLS = 120;
const METRICS_EVERY_POLLS = 10;
const LEASE_HEARTBEAT_MS = 10_000;
const CLEANUP_MAX_BATCHES = 20;

let pollTimer: NodeJS.Timeout | null = null;
let activePoll: Promise<void> | null = null;
let pollCount = 0;

/**
 * Register one topic consumer. The outbox guarantees an at-least-once handoff,
 * not exactly-once external delivery: a process can crash after the handler
 * succeeds but before DELIVERED is committed. Handlers must therefore use the
 * stable eventKey/payload identifier for downstream deduplication when the
 * provider supports it.
 */
export const registerOutboxHandler = (topic: string, handler: OutboxHandler): (() => void) => {
  const existing = handlers.get(topic);
  if (existing && existing !== handler) {
    throw new Error(`Outbox handler already registered for ${topic}`);
  }
  handlers.set(topic, handler);
  return () => {
    if (handlers.get(topic) === handler) handlers.delete(topic);
  };
};

interface ProcessBatchOptions {
  batchSize?: number;
  topic?: string;
  aggregateId?: string;
  leaseMs?: number;
  handlerTimeoutMs?: number;
}

const claimBatch = async ({
  batchSize = DEFAULT_BATCH_SIZE,
  topic,
  aggregateId,
  leaseMs = OUTBOX_LEASE_MS,
}: ProcessBatchOptions): Promise<OutboxEvent[]> => {
  const claimedAt = new Date();
  const staleBefore = new Date(claimedAt.getTime() - leaseMs);
  const topicFilter = topic ? Prisma.sql`AND "topic" = ${topic}` : Prisma.sql``;
  const aggregateFilter = aggregateId
    ? Prisma.sql`AND "aggregateId" = ${aggregateId}`
    : Prisma.sql``;

  return prisma.$transaction(tx =>
    tx.$queryRaw<OutboxEvent[]>(Prisma.sql`
      WITH candidates AS (
        SELECT id
        FROM "OutboxEvent"
        WHERE "deliveredAt" IS NULL
          AND "availableAt" <= ${claimedAt}
          AND (
            "status" = 'PENDING'
            OR (
              "status" = 'PROCESSING'
              AND ("claimedAt" IS NULL OR "claimedAt" <= ${staleBefore})
            )
          )
          ${topicFilter}
          ${aggregateFilter}
        ORDER BY "availableAt" ASC, id ASC
        FOR UPDATE SKIP LOCKED
        LIMIT ${Math.max(1, Math.min(batchSize, 100))}
      )
      UPDATE "OutboxEvent" AS event
      SET "status" = 'PROCESSING',
          "attempts" = event."attempts" + 1,
          "claimedAt" = ${claimedAt},
          "updatedAt" = ${claimedAt}
      FROM candidates
      WHERE event.id = candidates.id
      RETURNING event.*
    `),
  );
};

const retryDelayMs = (attempts: number): number =>
  Math.min(60_000, 1_000 * 2 ** Math.min(Math.max(attempts - 1, 0), 6));

const safeFailureCategory = (err: unknown): string => {
  if (!(err instanceof Error)) return 'NonErrorFailure';
  // These messages are entirely server-authored and contain no identifiers.
  if (/^(Invalid|Missing) .* outbox payload$/.test(err.message)) return err.message;
  if (/^No outbox handler registered$/.test(err.message)) return err.message;
  if (/^FCM batch contained retryable failures: [a-z0-9/,._-]+$/i.test(err.message)) {
    return err.message;
  }
  return err.name || 'Error';
};

class OutboxHandlerTimeoutError extends Error {
  constructor() {
    super('Outbox handler deadline exceeded');
    this.name = 'OutboxHandlerTimeout';
  }
}

const runHandlerWithDeadline = async (
  handler: OutboxHandler,
  event: OutboxEvent,
  timeoutMs: number,
): Promise<void> => {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      handler(event),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new OutboxHandlerTimeoutError()), timeoutMs);
        timer.unref();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

const processOne = async (
  event: OutboxEvent,
  handlerTimeoutMs = OUTBOX_HANDLER_TIMEOUT_MS,
): Promise<void> => {
  let currentClaimedAt = event.claimedAt;
  let heartbeatInFlight: Promise<void> = Promise.resolve();
  let leaseLost = false;
  const renewLease = async (): Promise<void> => {
    if (!currentClaimedAt || leaseLost) return;
    const nextClaimedAt = new Date();
    const renewed = await prisma.outboxEvent.updateMany({
      where: {
        id: event.id,
        status: 'PROCESSING',
        deliveredAt: null,
        claimedAt: currentClaimedAt,
      },
      data: { claimedAt: nextClaimedAt },
    });
    if (renewed.count === 1) currentClaimedAt = nextClaimedAt;
    else leaseLost = true;
  };
  const heartbeat = setInterval(() => {
    heartbeatInFlight = heartbeatInFlight.then(renewLease).catch(err => {
      logger.warn('outbox lease heartbeat failed', {
        eventId: event.id,
        topic: event.topic,
        category: safeFailureCategory(err),
      });
    });
  }, LEASE_HEARTBEAT_MS);
  heartbeat.unref();

  try {
    const handler = handlers.get(event.topic);
    if (!handler) throw new Error('No outbox handler registered');
    await runHandlerWithDeadline(handler, event, Math.max(1, Math.min(handlerTimeoutMs, 60_000)));
    clearInterval(heartbeat);
    await heartbeatInFlight;
    if (leaseLost || !currentClaimedAt) return;
    const delivered = await prisma.outboxEvent.updateMany({
      where: {
        id: event.id,
        status: 'PROCESSING',
        deliveredAt: null,
        claimedAt: currentClaimedAt,
      },
      data: {
        status: 'DELIVERED',
        deliveredAt: new Date(),
        claimedAt: null,
        lastError: null,
      },
    });
    if (delivered.count !== 1) {
      logger.warn('outbox lease lost before delivery acknowledgement', {
        eventId: event.id,
        topic: event.topic,
      });
      return;
    }
    outboxEventsTotal.inc({ topic: event.topic, result: 'delivered' });
  } catch (err) {
    clearInterval(heartbeat);
    await heartbeatInFlight;
    if (leaseLost || !currentClaimedAt) return;
    const category = safeFailureCategory(err).slice(0, 1000);
    const rescheduled = await prisma.outboxEvent.updateMany({
      where: {
        id: event.id,
        status: 'PROCESSING',
        deliveredAt: null,
        claimedAt: currentClaimedAt,
      },
      data: {
        status: 'PENDING',
        availableAt: new Date(Date.now() + retryDelayMs(event.attempts)),
        claimedAt: null,
        lastError: category,
      },
    });
    if (rescheduled.count !== 1) {
      logger.warn('outbox lease lost before retry acknowledgement', {
        eventId: event.id,
        topic: event.topic,
        category,
      });
      return;
    }
    const result = err instanceof OutboxHandlerTimeoutError ? 'timeout' : 'retry';
    outboxEventsTotal.inc({ topic: event.topic, result });
    logger.warn('outbox delivery failed; retry scheduled', {
      eventId: event.id,
      topic: event.topic,
      attempts: event.attempts,
      category,
    });
  }
};

export const processOutboxBatch = async (options: ProcessBatchOptions = {}): Promise<number> => {
  const events = await claimBatch(options);
  await Promise.all(events.map(event => processOne(event, options.handlerTimeoutMs)));
  return events.length;
};

/** Make failed/replayed aggregate events immediately eligible, then claim them. */
export const wakeAndProcessOutbox = async (topic: string, aggregateId: string): Promise<number> => {
  const now = new Date();
  const staleBefore = new Date(now.getTime() - OUTBOX_LEASE_MS);
  await prisma.outboxEvent.updateMany({
    where: {
      topic,
      aggregateId,
      deliveredAt: null,
      OR: [
        { status: 'PENDING' },
        { status: 'PROCESSING', claimedAt: null },
        { status: 'PROCESSING', claimedAt: { lte: staleBefore } },
      ],
    },
    data: { status: 'PENDING', availableAt: now, claimedAt: null },
  });
  return processOutboxBatch({ topic, aggregateId });
};

/** Bounded retention cleanup so delivered payloads do not become GDPR debt. */
export const cleanupDeliveredOutboxEvents = async (
  retentionMs = OUTBOX_RETENTION_MS,
  batchSize = 500,
): Promise<number> => {
  const expired = await prisma.outboxEvent.findMany({
    where: { status: 'DELIVERED', deliveredAt: { lt: new Date(Date.now() - retentionMs) } },
    select: { id: true },
    orderBy: { deliveredAt: 'asc' },
    take: Math.max(1, Math.min(batchSize, 1000)),
  });
  if (expired.length === 0) return 0;
  const removed = await prisma.outboxEvent.deleteMany({
    where: { id: { in: expired.map(event => event.id) }, status: 'DELIVERED' },
  });
  return removed.count;
};

const poll = async (): Promise<void> => {
  await processOutboxBatch();
  pollCount += 1;
  if (pollCount % METRICS_EVERY_POLLS === 0) {
    const [pending, processing, delivered, oldest] = await Promise.all([
      prisma.outboxEvent.count({ where: { status: 'PENDING' } }),
      prisma.outboxEvent.count({ where: { status: 'PROCESSING' } }),
      prisma.outboxEvent.count({ where: { status: 'DELIVERED' } }),
      prisma.outboxEvent.findFirst({
        where: { deliveredAt: null },
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
      }),
    ]);
    outboxBacklogGauge.set({ status: 'PENDING' }, pending);
    outboxBacklogGauge.set({ status: 'PROCESSING' }, processing);
    outboxBacklogGauge.set({ status: 'DELIVERED' }, delivered);
    outboxOldestPendingAgeSecondsGauge.set(
      oldest ? Math.max(0, (Date.now() - oldest.createdAt.getTime()) / 1000) : 0,
    );
  }
  if (pollCount % CLEANUP_EVERY_POLLS === 0) {
    for (let batch = 0; batch < CLEANUP_MAX_BATCHES; batch += 1) {
      const removed = await cleanupDeliveredOutboxEvents();
      if (removed < 500) break;
    }
  }
};

export const startOutboxWorker = (): void => {
  if (pollTimer) return;
  const tick = (): void => {
    if (activePoll) return;
    activePoll = poll()
      .catch(err => {
        logger.error('outbox polling failed', { err });
      })
      .finally(() => {
        activePoll = null;
      });
  };
  tick();
  pollTimer = setInterval(tick, POLL_INTERVAL_MS);
  pollTimer.unref();
  logger.info('transactional outbox worker started');
};

export const shutdownOutboxWorker = async (): Promise<void> => {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
  await activePoll;
  activePoll = null;
};
