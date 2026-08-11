export {};

const mockFanoutOne = jest.fn();
const mockEmitHallwayRoomCreated = jest.fn();
const mockRoomUpdate = jest.fn();
const mockParticipantUpsert = jest.fn();
const mockUserUpdate = jest.fn();

const roomState = {
  id: 'scheduled-room-1',
  hostId: 'host-1',
  clubId: null as string | null,
  title: 'Scheduled room',
  isLive: false,
  isPrivate: false,
  roomType: 'OPEN',
  endedAt: null as Date | null,
  scheduledFor: new Date('2026-08-10T12:00:00.000Z'),
  createdAt: new Date('2026-08-10T10:00:00.000Z'),
  recordingEnabled: false,
  participantCount: 0,
  totalAttendees: 0,
};

const mockTx = {
  $queryRaw: jest.fn().mockResolvedValue([]),
  room: {
    findUnique: jest.fn(async () => ({ ...roomState })),
    update: mockRoomUpdate,
  },
  user: {
    findUnique: jest.fn().mockResolvedValue({
      deletedAt: null,
      suspendedUntil: null,
      currentRoomId: null,
    }),
    update: mockUserUpdate,
  },
  participant: { upsert: mockParticipantUpsert },
};

const mockTransaction = jest.fn(
  async (callback: (tx: typeof mockTx) => Promise<unknown>): Promise<unknown> => callback(mockTx),
);
const mockRunWriteWithRetry = jest.fn(
  async (operation: () => Promise<unknown>): Promise<unknown> => operation(),
);

jest.mock('../src/config/database', () => ({
  prisma: {
    $transaction: (...args: unknown[]) =>
      mockTransaction(...(args as Parameters<typeof mockTransaction>)),
  },
  runWriteWithRetry: (...args: unknown[]) =>
    mockRunWriteWithRetry(...(args as Parameters<typeof mockRunWriteWithRetry>)),
}));
jest.mock('../src/config/logger', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn() },
}));
jest.mock('../src/extensions/queues/followFanout', () => ({
  fanoutOne: (...args: unknown[]) => mockFanoutOne(...args),
}));
jest.mock('../src/extensions/queues/reminder15', () => ({
  cancelReminder15: jest.fn(),
  scheduleReminder15: jest.fn(),
}));
jest.mock('../src/modules/notifications/notifications.service', () => ({
  notificationsService: { create: jest.fn() },
}));
jest.mock('../src/modules/social/blocks', () => ({ getBlockedIdSet: jest.fn() }));
jest.mock('../src/queues/connection', () => ({ bullConnection: jest.fn() }));
jest.mock('../src/socket/realtime', () => ({
  emitHallwayRoomCreated: (...args: unknown[]) => mockEmitHallwayRoomCreated(...args),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { _internals } =
  require('../src/queues/eventReminders') as typeof import('../src/queues/eventReminders');

describe('scheduled room ROOM_STARTED fan-out repair', () => {
  beforeEach(() => {
    Object.assign(roomState, {
      isLive: false,
      endedAt: null,
      participantCount: 0,
      totalAttendees: 0,
    });
    mockRoomUpdate.mockImplementation(async () => {
      roomState.isLive = true;
      roomState.participantCount = 1;
      roomState.totalAttendees += 1;
      return { ...roomState };
    });
    mockParticipantUpsert.mockResolvedValue({ id: 'participant-1' });
    mockUserUpdate.mockResolvedValue({ id: roomState.hostId });
    mockFanoutOne.mockResolvedValue(0);
  });

  it('repairs fan-out on a noop-live retry without opening or seating twice', async () => {
    mockFanoutOne.mockRejectedValueOnce(new Error('one recipient failed')).mockResolvedValueOnce(1);

    await expect(_internals.openScheduledRoom(roomState.id)).rejects.toThrow(
      'one recipient failed',
    );
    expect(roomState.isLive).toBe(true);

    await expect(_internals.openScheduledRoom(roomState.id)).resolves.toBeUndefined();

    expect(mockFanoutOne).toHaveBeenCalledTimes(2);
    expect(mockFanoutOne).toHaveBeenNthCalledWith(1, roomState.id);
    expect(mockFanoutOne).toHaveBeenNthCalledWith(2, roomState.id);
    expect(mockRoomUpdate).toHaveBeenCalledTimes(1);
    expect(mockParticipantUpsert).toHaveBeenCalledTimes(1);
    expect(mockParticipantUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ admissionConfirmedAt: null }),
        update: expect.objectContaining({ admissionConfirmedAt: null }),
      }),
    );
    expect(mockUserUpdate).toHaveBeenCalledTimes(1);
    expect(mockEmitHallwayRoomCreated).toHaveBeenCalledTimes(1);
    expect(roomState.totalAttendees).toBe(1);
  });
});
