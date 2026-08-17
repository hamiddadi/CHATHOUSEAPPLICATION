jest.mock('../src/config/database', () => ({
  prisma: {
    room: { findFirst: jest.fn() },
    roomRsvp: { findMany: jest.fn() },
    clubMember: { findMany: jest.fn() },
    $transaction: jest.fn(),
  },
}));
jest.mock('../src/modules/social/blocks', () => ({
  getBlockedIdSet: jest.fn(),
}));
jest.mock('../src/modules/notifications/notification.outbox', () => ({
  notificationDeliveryOutboxData: jest.fn((notificationId: string, aggregateId: string) => ({
    eventKey: `notification-delivery:${notificationId}`,
    topic: 'notification.deliver',
    aggregateId,
    payload: { notificationId },
  })),
  wakeNotificationDelivery: jest.fn().mockResolvedValue(0),
}));
jest.mock('../src/queues/connection', () => ({ bullConnection: jest.fn() }));

import type { Job } from 'bullmq';
import { prisma } from '../src/config/database';
import { getBlockedIdSet } from '../src/modules/social/blocks';
import { wakeNotificationDelivery } from '../src/modules/notifications/notification.outbox';
import { processReminder15, type Reminder15JobData } from '../src/extensions/queues/reminder15';

describe('T-15 reminder fanout', () => {
  it('pages recipients and remains idempotent across job retries', async () => {
    const transactionOutboxKeys = new Set<string>();
    const notificationIds = new Set<string>();
    const transaction = {
      outboxEvent: {
        findMany: jest.fn(({ where }: { where: { eventKey: { in: string[] } } }) =>
          Promise.resolve(
            where.eventKey.in
              .filter(eventKey => transactionOutboxKeys.has(eventKey))
              .map(eventKey => ({ eventKey })),
          ),
        ),
        createMany: jest.fn(({ data }: { data: Array<{ eventKey: string }> }) => {
          for (const item of data) transactionOutboxKeys.add(item.eventKey);
          return Promise.resolve({ count: data.length });
        }),
      },
      notification: {
        createMany: jest.fn(({ data }: { data: Array<{ id: string }> }) => {
          for (const item of data) notificationIds.add(item.id);
          return Promise.resolve({ count: data.length });
        }),
      },
    };

    jest.mocked(prisma.room.findFirst).mockResolvedValue({
      id: 'room-a',
      title: 'Weekly room',
      hostId: 'host-a',
      clubId: 'club-a',
      endedAt: null,
      canceledAt: null,
      scheduledFor: new Date(Date.now() + 15 * 60 * 1000),
    } as never);
    jest
      .mocked(prisma.roomRsvp.findMany)
      .mockResolvedValue([{ userId: 'rsvp-a' }, { userId: 'both-a' }] as never);
    jest
      .mocked(prisma.clubMember.findMany)
      .mockResolvedValue([{ userId: 'both-a' }, { userId: 'blocked-a' }] as never);
    jest.mocked(getBlockedIdSet).mockResolvedValue(new Set(['blocked-a']));
    jest
      .mocked(prisma.$transaction)
      .mockImplementation(async callback => callback(transaction as never));

    const job = { data: { roomId: 'room-a' } } as Job<Reminder15JobData>;
    await processReminder15(job);
    await processReminder15(job);

    expect(notificationIds.size).toBe(3);
    expect(transactionOutboxKeys.size).toBe(3);
    expect(transaction.notification.createMany).toHaveBeenCalledTimes(2);
    expect(transaction.outboxEvent.createMany).toHaveBeenCalledTimes(2);
    expect(wakeNotificationDelivery).toHaveBeenCalledTimes(2);
    expect(wakeNotificationDelivery).toHaveBeenCalledWith('room-a');
  });
});
