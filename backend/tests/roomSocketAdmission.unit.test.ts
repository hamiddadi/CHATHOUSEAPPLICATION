export {};

const mockJoin = jest.fn();
const mockConfirm = jest.fn();
const mockCompensate = jest.fn();
const mockEmitMapUserUpdate = jest.fn().mockResolvedValue(undefined);

jest.mock('../src/modules/rooms/rooms.service', () => ({
  roomsService: {
    join: (...args: unknown[]) => mockJoin(...args),
    confirmSocketAdmission: (...args: unknown[]) => mockConfirm(...args),
    compensateUnconfirmedAdmission: (...args: unknown[]) => mockCompensate(...args),
  },
}));
jest.mock('../src/config/logger', () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn() },
}));
jest.mock('../src/socket/realtime', () => ({
  emitMapUserUpdate: (...args: unknown[]) => mockEmitMapUserUpdate(...args),
}));
jest.mock('../src/socket/socket.middleware', () => ({
  getUserId: () => 'user-1',
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { registerRoomHandlers } =
  require('../src/socket/handlers/room.handler') as typeof import('../src/socket/handlers/room.handler');

const admission = {
  participantId: 'participant-1',
  joinedAt: new Date('2026-08-11T00:00:00.000Z'),
  admissionConfirmedAt: null,
};

const setup = () => {
  const handlers = new Map<string, (...args: never[]) => unknown>();
  const socket = {
    on: jest.fn((event: string, handler: (...args: never[]) => unknown) => {
      handlers.set(event, handler);
    }),
    join: jest.fn().mockResolvedValue(undefined),
    leave: jest.fn().mockResolvedValue(undefined),
    emit: jest.fn(),
  };
  const roomEmit = jest.fn();
  const io = { to: jest.fn(() => ({ emit: roomEmit })) };
  registerRoomHandlers(io as never, socket as never);
  const invokeJoin = async (ack = jest.fn()) => {
    const handler = handlers.get('room:join');
    if (!handler) throw new Error('room:join handler was not registered');
    await handler({ roomId: 'room-1' } as never, ack as never);
    return ack;
  };
  return { socket, roomEmit, invokeJoin };
};

describe('Socket.IO room admission commit/compensation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockJoin.mockResolvedValue({ participants: [], admission });
    mockConfirm.mockResolvedValue(true);
    mockCompensate.mockResolvedValue({ changed: true });
  });

  it('broadcasts success only after the channel join and database confirmation', async () => {
    const { socket, roomEmit, invokeJoin } = setup();
    const ack = await invokeJoin();

    expect(socket.join).toHaveBeenCalledWith('room:room-1');
    expect(mockConfirm).toHaveBeenCalledWith('room-1', 'user-1');
    expect(mockConfirm.mock.invocationCallOrder[0]).toBeLessThan(
      roomEmit.mock.invocationCallOrder[0]!,
    );
    expect(mockCompensate).not.toHaveBeenCalled();
    expect(ack).toHaveBeenCalledWith(true);
  });

  it('leaves the channel and compensates the exact lease when confirmation loses', async () => {
    mockConfirm.mockResolvedValue(false);
    const { socket, roomEmit, invokeJoin } = setup();
    const ack = await invokeJoin();

    expect(socket.leave).toHaveBeenCalledWith('room:room-1');
    expect(mockCompensate).toHaveBeenCalledWith('room-1', 'user-1', admission);
    expect(roomEmit).not.toHaveBeenCalled();
    expect(ack).toHaveBeenCalledWith(false);
  });

  it('compensates a database lease when joining the Socket.IO channel throws', async () => {
    const { socket, invokeJoin } = setup();
    socket.join.mockRejectedValueOnce(new Error('adapter join failed'));
    const ack = await invokeJoin();

    expect(socket.leave).not.toHaveBeenCalled();
    expect(mockCompensate).toHaveBeenCalledWith('room-1', 'user-1', admission);
    expect(ack).toHaveBeenCalledWith(false);
  });
});
