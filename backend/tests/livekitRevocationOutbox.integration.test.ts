import { randomUUID } from 'node:crypto';

process.env.DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://chathouse:chathouse@localhost:5433/chathouse?schema=public';

const mockRemoveParticipant = jest.fn<Promise<void>, [string, string]>();
const mockSetParticipantCanPublish = jest.fn<Promise<void>, [string, string, boolean]>();
const mockDeleteRoom = jest.fn<Promise<void>, [string]>();

jest.mock('../src/modules/rooms/livekit.service', () => ({
  livekitService: {
    isConfigured: () => true,
    removeParticipant: (roomId: string, userId: string) => mockRemoveParticipant(roomId, userId),
    setParticipantCanPublish: (roomId: string, userId: string, canPublish: boolean) =>
      mockSetParticipantCanPublish(roomId, userId, canPublish),
    deleteRoom: (roomId: string) => mockDeleteRoom(roomId),
  },
}));

/* eslint-disable @typescript-eslint/no-require-imports */
const { prisma } = require('../src/config/database') as typeof import('../src/config/database');
const { processOutboxBatch } =
  require('../src/workers/outbox.worker') as typeof import('../src/workers/outbox.worker');
const {
  LIVEKIT_REVOCATION_TOPIC,
  LIVEKIT_REVOCATION_CONFIRMATION_MS,
  livekitRevocationOutboxData,
  wakeLivekitRevocation,
} =
  require('../src/modules/rooms/livekit-revocation.outbox') as typeof import('../src/modules/rooms/livekit-revocation.outbox');
const {
  LIVEKIT_ROOM_REVOCATION_TOPIC,
  livekitRoomRevocationOutboxData,
  wakeLivekitRoomRevocation,
} =
  require('../src/modules/rooms/livekit-room-revocation.outbox') as typeof import('../src/modules/rooms/livekit-room-revocation.outbox');
const { dispatchVerifiedLivekitWebhook } =
  require('../src/modules/recordings/recordings.service') as typeof import('../src/modules/recordings/recordings.service');
/* eslint-enable @typescript-eslint/no-require-imports */

describe('durable LiveKit participant revocation', () => {
  const userIds: string[] = [];
  const roomIds: string[] = [];
  const transitionIds: string[] = [];

  beforeEach(() => {
    mockRemoveParticipant.mockReset();
    mockSetParticipantCanPublish.mockReset().mockResolvedValue(undefined);
    mockDeleteRoom.mockReset();
  });

  afterEach(async () => {
    await prisma.outboxEvent.deleteMany({
      where: { eventKey: { in: transitionIds.splice(0) } },
    });
    for (const roomId of roomIds.splice(0)) {
      await prisma.outboxEvent.deleteMany({
        where: { payload: { path: ['roomId'], equals: roomId } },
      });
      await prisma.room.delete({ where: { id: roomId } }).catch(() => undefined);
    }
    for (const userId of userIds.splice(0)) {
      await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
    }
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const fixture = async (active: boolean) => {
    const hostId = randomUUID();
    const userId = randomUUID();
    const roomId = randomUUID();
    userIds.push(hostId, userId);
    roomIds.push(roomId);
    await prisma.user.createMany({
      data: [
        { id: hostId, username: `lk_host_${hostId.slice(0, 8)}` },
        { id: userId, username: `lk_user_${userId.slice(0, 8)}` },
      ],
    });
    await prisma.room.create({
      data: { id: roomId, title: 'LiveKit revocation', hostId, participantCount: active ? 2 : 1 },
    });
    await prisma.participant.create({
      data: {
        roomId,
        userId,
        leftAt: active ? null : new Date(),
        admissionConfirmedAt: active ? new Date() : null,
      },
    });
    return { hostId, roomId, userId };
  };

  const waitForBlockedRoomMutation = async (): Promise<void> => {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const rows = await prisma.$queryRaw<Array<{ waiting: boolean }>>`
        SELECT EXISTS (
          SELECT 1
          FROM pg_stat_activity AS activity
          WHERE cardinality(pg_blocking_pids(activity.pid)) > 0
            AND activity.query LIKE '%FROM "Room"%FOR UPDATE%'
        ) AS waiting
      `;
      if (rows[0]?.waiting) return;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error('Timed out waiting for the room mutation to reach the policy lock');
  };

  const enqueue = async (roomId: string, userId: string, createdAt?: Date) => {
    const transitionId = randomUUID();
    transitionIds.push(transitionId);
    return prisma.outboxEvent.create({
      data: {
        ...livekitRevocationOutboxData({ roomId, userId }, transitionId),
        ...(createdAt ? { createdAt } : {}),
      },
    });
  };

  it('retries a provider failure and marks the same transition delivered after success', async () => {
    const { roomId, userId } = await fixture(false);
    const event = await enqueue(
      roomId,
      userId,
      new Date(Date.now() - LIVEKIT_REVOCATION_CONFIRMATION_MS - 1_000),
    );
    mockRemoveParticipant
      .mockRejectedValueOnce(Object.assign(new Error('provider unavailable'), { status: 503 }))
      .mockResolvedValueOnce(undefined);

    expect(
      await processOutboxBatch({
        topic: LIVEKIT_REVOCATION_TOPIC,
        aggregateId: event.aggregateId ?? undefined,
      }),
    ).toBe(1);
    expect(await prisma.outboxEvent.findUniqueOrThrow({ where: { id: event.id } })).toEqual(
      expect.objectContaining({
        status: 'PENDING',
        attempts: 1,
        deliveredAt: null,
        lastError: 'Error',
      }),
    );

    expect(await wakeLivekitRevocation(event.aggregateId as string)).toBe(1);
    expect(await prisma.outboxEvent.findUniqueOrThrow({ where: { id: event.id } })).toEqual(
      expect.objectContaining({
        status: 'PENDING',
        attempts: 2,
        effectStartedAt: expect.any(Date),
      }),
    );
    await prisma.outboxEvent.update({
      where: { id: event.id },
      data: {
        effectStartedAt: new Date(Date.now() - LIVEKIT_REVOCATION_CONFIRMATION_MS - 1_000),
      },
    });
    expect(await wakeLivekitRevocation(event.aggregateId as string)).toBe(1);
    expect(mockRemoveParticipant).toHaveBeenNthCalledWith(1, roomId, userId);
    expect(mockRemoveParticipant).toHaveBeenNthCalledWith(2, roomId, userId);
    expect(mockRemoveParticipant).toHaveBeenNthCalledWith(3, roomId, userId);
    expect(await prisma.outboxEvent.findUniqueOrThrow({ where: { id: event.id } })).toEqual(
      expect.objectContaining({
        status: 'DELIVERED',
        attempts: 3,
        lastError: null,
      }),
    );
  });

  it('treats an old transition as a no-op when the user has rejoined', async () => {
    const { roomId, userId } = await fixture(true);
    const event = await enqueue(
      roomId,
      userId,
      new Date(Date.now() - LIVEKIT_REVOCATION_CONFIRMATION_MS - 1_000),
    );
    await prisma.outboxEvent.update({
      where: { id: event.id },
      data: {
        effectStartedAt: new Date(Date.now() - LIVEKIT_REVOCATION_CONFIRMATION_MS - 1_000),
      },
    });
    mockRemoveParticipant.mockResolvedValue(undefined);

    expect(
      await processOutboxBatch({
        topic: LIVEKIT_REVOCATION_TOPIC,
        aggregateId: event.aggregateId ?? undefined,
      }),
    ).toBe(1);
    expect(mockRemoveParticipant).not.toHaveBeenCalled();
    expect(mockSetParticipantCanPublish).toHaveBeenCalledWith(roomId, userId, false);
    expect(await prisma.outboxEvent.findUniqueOrThrow({ where: { id: event.id } })).toEqual(
      expect.objectContaining({ status: 'DELIVERED', attempts: 1 }),
    );
  });

  it('removes a provider join that has no Socket.IO admission confirmation', async () => {
    const { roomId, userId } = await fixture(true);
    await prisma.participant.update({
      where: { userId_roomId: { roomId, userId } },
      data: { admissionConfirmedAt: null },
    });

    await dispatchVerifiedLivekitWebhook({
      event: 'participant_joined',
      room: { name: roomId },
      participant: { identity: userId },
    } as unknown as Parameters<typeof dispatchVerifiedLivekitWebhook>[0]);

    expect(mockRemoveParticipant).toHaveBeenCalledWith(roomId, userId);
    expect(mockSetParticipantCanPublish).not.toHaveBeenCalled();
    expect(
      (
        await prisma.participant.findUniqueOrThrow({
          where: { userId_roomId: { roomId, userId } },
        })
      ).admissionConfirmedAt,
    ).toBeNull();
  });

  it('orders a verified participant_joined policy write before a concurrent mute', async () => {
    const { roomId, userId } = await fixture(true);
    const acceptedAt = new Date();
    await prisma.user.update({
      where: { id: userId },
      data: {
        termsAcceptedVersion: '2026-07-29',
        termsAcceptedAt: acceptedAt,
        privacyNoticeAcknowledgedVersion: '2026-07-29',
        privacyNoticeAcknowledgedAt: acceptedAt,
        legalAcceptanceLocale: 'en',
      },
    });
    await prisma.participant.update({
      where: { userId_roomId: { roomId, userId } },
      data: { role: 'SPEAKER', isMuted: false },
    });

    let releaseInitialProvider!: () => void;
    let markInitialProviderEntered!: () => void;
    const initialProviderEntered = new Promise<void>(resolve => {
      markInitialProviderEntered = resolve;
    });
    const holdInitialProvider = new Promise<void>(resolve => {
      releaseInitialProvider = resolve;
    });
    mockSetParticipantCanPublish
      .mockImplementationOnce(async (_roomId, _userId, canPublish) => {
        expect(canPublish).toBe(true);
        markInitialProviderEntered();
        await holdInitialProvider;
      })
      .mockResolvedValue(undefined);

    const webhook = dispatchVerifiedLivekitWebhook({
      event: 'participant_joined',
      room: { name: roomId },
      participant: { identity: userId },
    } as unknown as Parameters<typeof dispatchVerifiedLivekitWebhook>[0]);
    await initialProviderEntered;

    const muteTransitionId = randomUUID();
    transitionIds.push(muteTransitionId);
    const mute = prisma
      .$transaction(async tx => {
        await tx.$queryRaw`SELECT "id" FROM "Room" WHERE "id" = ${roomId} FOR UPDATE`;
        await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
        await tx.participant.update({
          where: { userId_roomId: { roomId, userId } },
          data: { isMuted: true },
        });
        await tx.outboxEvent.create({
          data: livekitRevocationOutboxData({ roomId, userId }, muteTransitionId),
        });
      })
      .then(() => wakeLivekitRevocation(muteTransitionId));
    await waitForBlockedRoomMutation();
    releaseInitialProvider();
    await Promise.all([webhook, mute]);

    expect(mockSetParticipantCanPublish).toHaveBeenNthCalledWith(1, roomId, userId, true);
    expect(mockSetParticipantCanPublish).toHaveBeenLastCalledWith(roomId, userId, false);
    expect(
      (
        await prisma.participant.findUniqueOrThrow({
          where: { userId_roomId: { roomId, userId } },
        })
      ).isMuted,
    ).toBe(true);
  });

  it('fails a webhook policy attempt before any provider call when the room lock times out', async () => {
    const { roomId, userId } = await fixture(true);
    const event = {
      event: 'participant_joined',
      room: { name: roomId },
      participant: { identity: userId },
    } as unknown as Parameters<typeof dispatchVerifiedLivekitWebhook>[0];

    await prisma.$transaction(
      async tx => {
        await tx.$queryRaw`SELECT "id" FROM "Room" WHERE "id" = ${roomId} FOR UPDATE`;
        await expect(dispatchVerifiedLivekitWebhook(event)).rejects.toBeDefined();
        expect(mockSetParticipantCanPublish).not.toHaveBeenCalled();
        expect(mockRemoveParticipant).not.toHaveBeenCalled();
      },
      { maxWait: 5_000, timeout: 5_000 },
    );

    await expect(dispatchVerifiedLivekitWebhook(event)).resolves.toBeUndefined();
    expect(mockSetParticipantCanPublish).toHaveBeenCalledTimes(1);
  });

  it('keeps an outbox policy event retryable when its room lock times out', async () => {
    const { roomId, userId } = await fixture(true);
    const event = await enqueue(roomId, userId);

    await prisma.$transaction(
      async tx => {
        await tx.$queryRaw`SELECT "id" FROM "Room" WHERE "id" = ${roomId} FOR UPDATE`;
        expect(
          await processOutboxBatch({
            topic: LIVEKIT_REVOCATION_TOPIC,
            aggregateId: event.aggregateId ?? undefined,
          }),
        ).toBe(1);
        expect(mockSetParticipantCanPublish).not.toHaveBeenCalled();
        expect(mockRemoveParticipant).not.toHaveBeenCalled();
      },
      { maxWait: 5_000, timeout: 5_000 },
    );

    expect(await prisma.outboxEvent.findUniqueOrThrow({ where: { id: event.id } })).toEqual(
      expect.objectContaining({ status: 'PENDING', attempts: 1, effectStartedAt: null }),
    );
    expect(await wakeLivekitRevocation(event.aggregateId as string)).toBe(1);
    expect(mockSetParticipantCanPublish).toHaveBeenCalledTimes(1);
    expect(await prisma.outboxEvent.findUniqueOrThrow({ where: { id: event.id } })).toEqual(
      expect.objectContaining({
        status: 'PENDING',
        attempts: 2,
        effectStartedAt: expect.any(Date),
      }),
    );
  });

  it('retries room deletion failures and acknowledges the final post-horizon delete', async () => {
    const { roomId } = await fixture(false);
    await prisma.room.update({
      where: { id: roomId },
      data: { isLive: false, endedAt: new Date() },
    });
    const transitionId = randomUUID();
    transitionIds.push(transitionId);
    const event = await prisma.outboxEvent.create({
      data: {
        ...livekitRoomRevocationOutboxData(roomId, transitionId),
        createdAt: new Date(Date.now() - LIVEKIT_REVOCATION_CONFIRMATION_MS - 1_000),
      },
    });
    mockDeleteRoom
      .mockRejectedValueOnce(Object.assign(new Error('provider unavailable'), { status: 503 }))
      .mockResolvedValueOnce(undefined);

    expect(
      await processOutboxBatch({
        topic: LIVEKIT_ROOM_REVOCATION_TOPIC,
        aggregateId: roomId,
      }),
    ).toBe(1);
    expect(await prisma.outboxEvent.findUniqueOrThrow({ where: { id: event.id } })).toEqual(
      expect.objectContaining({ status: 'PENDING', attempts: 1, lastError: 'Error' }),
    );
    expect(await wakeLivekitRoomRevocation(roomId)).toBe(1);
    expect(await prisma.outboxEvent.findUniqueOrThrow({ where: { id: event.id } })).toEqual(
      expect.objectContaining({
        status: 'PENDING',
        attempts: 2,
        effectStartedAt: expect.any(Date),
      }),
    );
    await prisma.outboxEvent.update({
      where: { id: event.id },
      data: {
        effectStartedAt: new Date(Date.now() - LIVEKIT_REVOCATION_CONFIRMATION_MS - 1_000),
      },
    });
    expect(await wakeLivekitRoomRevocation(roomId)).toBe(1);
    expect(mockDeleteRoom).toHaveBeenCalledTimes(3);
    expect(await prisma.outboxEvent.findUniqueOrThrow({ where: { id: event.id } })).toEqual(
      expect.objectContaining({ status: 'DELIVERED', attempts: 3, lastError: null }),
    );
  });

  it('does not delete a live provider room for a stale closure event', async () => {
    const { roomId } = await fixture(true);
    const transitionId = randomUUID();
    transitionIds.push(transitionId);
    const event = await prisma.outboxEvent.create({
      data: livekitRoomRevocationOutboxData(roomId, transitionId),
    });

    expect(
      await processOutboxBatch({ topic: LIVEKIT_ROOM_REVOCATION_TOPIC, aggregateId: roomId }),
    ).toBe(1);
    expect(mockDeleteRoom).not.toHaveBeenCalled();
    expect(await prisma.outboxEvent.findUniqueOrThrow({ where: { id: event.id } })).toEqual(
      expect.objectContaining({ status: 'DELIVERED', attempts: 1 }),
    );
  });
});
