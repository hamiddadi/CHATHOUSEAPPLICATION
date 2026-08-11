export {};

const mockFindMany = jest.fn();
const mockUpdateMany = jest.fn();
const mockExpireStaleAdmission = jest.fn();
const mockFetchSockets = jest.fn();
const mockIn = jest.fn(() => ({ fetchSockets: mockFetchSockets }));

jest.mock('../src/config/database', () => ({
  prisma: {
    participant: {
      findMany: (...args: unknown[]) => mockFindMany(...args),
      updateMany: (...args: unknown[]) => mockUpdateMany(...args),
    },
  },
}));

jest.mock('../src/config/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
}));

jest.mock('../src/modules/rooms/rooms.service', () => ({
  roomsService: {
    expireStaleAdmission: (...args: unknown[]) => mockExpireStaleAdmission(...args),
  },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { reconcileParticipantAdmissions, PARTICIPANT_ADMISSION_GRACE_MS } =
  require('../src/queues/participantAdmissionCleanup') as typeof import('../src/queues/participantAdmissionCleanup');

const now = new Date('2026-08-11T00:00:00.000Z');
const old = new Date(now.getTime() - PARTICIPANT_ADMISSION_GRACE_MS - 1_000);
const candidate = {
  id: 'participant-1',
  roomId: 'room-1',
  userId: 'user-1',
  joinedAt: old,
  admissionConfirmedAt: old,
};
const io = { in: mockIn };

describe('participant admission reconciliation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFindMany.mockReset();
    mockFindMany.mockResolvedValueOnce([]).mockResolvedValueOnce([candidate]);
    mockUpdateMany.mockResolvedValue({ count: 1 });
    mockExpireStaleAdmission.mockResolvedValue({ changed: true });
    mockFetchSockets.mockResolvedValue([]);
  });

  it('aborts the entire cycle when the cluster socket snapshot fails', async () => {
    mockFetchSockets.mockRejectedValue(new Error('redis adapter unavailable'));

    await expect(reconcileParticipantAdmissions(io as never, now)).rejects.toThrow(
      'redis adapter unavailable',
    );
    expect(mockUpdateMany).not.toHaveBeenCalled();
    expect(mockExpireStaleAdmission).not.toHaveBeenCalled();
  });

  it('heartbeats an observed peer and never expires it in the same snapshot', async () => {
    mockFindMany.mockResolvedValueOnce([candidate]);
    mockFetchSockets.mockResolvedValue([
      { data: { userId: 'user-1' }, rooms: new Set(['socket-1', 'room:room-1']) },
    ]);
    mockUpdateMany.mockResolvedValue({ count: 0 });

    await expect(reconcileParticipantAdmissions(io as never, now)).resolves.toEqual({
      scanned: 1,
      present: 1,
      heartbeated: 0,
      expired: 0,
    });
    expect(mockExpireStaleAdmission).not.toHaveBeenCalled();
  });

  it('never promotes an unconfirmed lease merely because a socket channel is present', async () => {
    const unconfirmed = { ...candidate, admissionConfirmedAt: null };
    mockFindMany.mockReset();
    mockFindMany
      .mockResolvedValueOnce([unconfirmed])
      .mockResolvedValueOnce([])
      // Defence in depth: even a faulty adapter result must not promote null.
      .mockResolvedValueOnce([unconfirmed]);
    mockFetchSockets.mockResolvedValue([
      { data: { userId: 'user-1' }, rooms: new Set(['room:room-1']) },
    ]);

    await expect(reconcileParticipantAdmissions(io as never, now)).resolves.toEqual({
      scanned: 1,
      present: 0,
      heartbeated: 0,
      expired: 1,
    });
    expect(mockUpdateMany).not.toHaveBeenCalled();
    expect(mockExpireStaleAdmission).toHaveBeenCalledWith(
      'room-1',
      'user-1',
      expect.objectContaining({ admissionConfirmedAt: null }),
      expect.any(Date),
      expect.any(Function),
    );
  });

  it('passes the exact absent lease identity and cutoff to transactional expiry', async () => {
    await expect(reconcileParticipantAdmissions(io as never, now)).resolves.toEqual({
      scanned: 1,
      present: 0,
      heartbeated: 0,
      expired: 1,
    });
    expect(mockExpireStaleAdmission).toHaveBeenCalledWith(
      'room-1',
      'user-1',
      {
        participantId: 'participant-1',
        joinedAt: old,
        admissionConfirmedAt: old,
      },
      new Date(now.getTime() - PARTICIPANT_ADMISSION_GRACE_MS),
      expect.any(Function),
    );
  });

  it('reserves progress for both null and confirmed leases under saturation', async () => {
    const abandoned = Array.from({ length: 100 }, (_, index) => ({
      ...candidate,
      id: `null-${index}`,
      userId: `null-user-${index}`,
      admissionConfirmedAt: null,
    }));
    const confirmed = Array.from({ length: 100 }, (_, index) => ({
      ...candidate,
      id: `confirmed-${index}`,
      userId: `confirmed-user-${index}`,
    }));
    mockFindMany.mockReset();
    mockFindMany.mockResolvedValueOnce(abandoned).mockResolvedValueOnce(confirmed);
    mockExpireStaleAdmission.mockResolvedValue({ changed: false });

    await expect(reconcileParticipantAdmissions(io as never, now)).resolves.toEqual({
      scanned: 100,
      present: 0,
      heartbeated: 0,
      expired: 0,
    });

    expect(mockFindMany.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        where: expect.objectContaining({ admissionConfirmedAt: null }),
        take: 100,
      }),
    );
    expect(mockFindMany.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({
        where: expect.objectContaining({
          admissionConfirmedAt: { not: null, lte: expect.any(Date) },
        }),
        take: 100,
      }),
    );
    const expiredIds = mockExpireStaleAdmission.mock.calls.map(
      (call: unknown[]) => (call[2] as { participantId: string }).participantId,
    );
    expect(expiredIds).toContain('null-0');
    expect(expiredIds).toContain('confirmed-0');
  });

  it('does not launch orphaned heartbeat writes or any expiry after a heartbeat error', async () => {
    const secondCandidate = {
      ...candidate,
      id: 'participant-2',
      userId: 'user-2',
    };
    mockFindMany.mockReset();
    mockFindMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([candidate, secondCandidate])
      .mockResolvedValueOnce([candidate, secondCandidate]);
    mockFetchSockets.mockResolvedValue([
      { data: { userId: 'user-1' }, rooms: new Set(['room:room-1']) },
      { data: { userId: 'user-2' }, rooms: new Set(['room:room-1']) },
    ]);
    mockUpdateMany.mockRejectedValueOnce(new Error('heartbeat failed'));

    await expect(reconcileParticipantAdmissions(io as never, now)).rejects.toThrow(
      'heartbeat failed',
    );
    expect(mockUpdateMany).toHaveBeenCalledTimes(1);
    expect(mockExpireStaleAdmission).not.toHaveBeenCalled();
  });

  it('heartbeats a connected successor outside the 100-row stale page before expiring a host', async () => {
    const page = Array.from({ length: 100 }, (_, index) => ({
      ...candidate,
      id: `participant-${index}`,
      roomId: index === 0 ? 'handoff-room' : `filler-room-${index}`,
      userId: index === 0 ? 'absent-host' : `filler-user-${index}`,
    }));
    const successor = {
      ...candidate,
      id: 'participant-101',
      roomId: 'handoff-room',
      userId: 'connected-successor',
    };
    mockFindMany.mockReset();
    mockFindMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(page)
      .mockResolvedValueOnce([successor]);
    mockFetchSockets.mockResolvedValue([
      {
        data: { userId: successor.userId },
        rooms: new Set([`room:${successor.roomId}`]),
      },
    ]);
    mockUpdateMany.mockResolvedValue({ count: 1 });
    mockExpireStaleAdmission.mockResolvedValue({ changed: false });

    const result = await reconcileParticipantAdmissions(io as never, now);

    expect(result).toEqual({ scanned: 100, present: 0, heartbeated: 1, expired: 0 });
    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: {
        leftAt: null,
        OR: [
          {
            id: successor.id,
            joinedAt: successor.joinedAt,
            admissionConfirmedAt: successor.admissionConfirmedAt,
          },
        ],
      },
      data: { admissionConfirmedAt: now },
    });
    expect(mockUpdateMany.mock.invocationCallOrder[0]).toBeLessThan(
      mockExpireStaleAdmission.mock.invocationCallOrder[0] as number,
    );
  });

  it('defers remaining expiries once the cluster snapshot reaches the grace age', async () => {
    const secondCandidate = {
      ...candidate,
      id: 'participant-2',
      userId: 'user-2',
    };
    mockFindMany.mockReset();
    mockFindMany.mockResolvedValueOnce([]).mockResolvedValueOnce([candidate, secondCandidate]);
    const monotonicNow = jest
      .fn()
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(1)
      .mockReturnValue(PARTICIPANT_ADMISSION_GRACE_MS);

    await expect(reconcileParticipantAdmissions(io as never, now, monotonicNow)).resolves.toEqual({
      scanned: 2,
      present: 0,
      heartbeated: 0,
      expired: 1,
    });
    expect(mockExpireStaleAdmission).toHaveBeenCalledTimes(1);
  });

  it('passes a deadline guard that can reject a snapshot after lock wait', async () => {
    const monotonicNow = jest
      .fn()
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(1)
      .mockReturnValue(PARTICIPANT_ADMISSION_GRACE_MS);
    mockExpireStaleAdmission.mockImplementationOnce(async (...args: unknown[]) => ({
      changed: (args[4] as () => boolean)(),
    }));

    await expect(reconcileParticipantAdmissions(io as never, now, monotonicNow)).resolves.toEqual({
      scanned: 1,
      present: 0,
      heartbeated: 0,
      expired: 0,
    });
    expect(mockExpireStaleAdmission).toHaveBeenCalledTimes(1);
  });
});
