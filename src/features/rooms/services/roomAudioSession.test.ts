import type { Socket } from 'socket.io-client';
import { getSocket } from '../../../shared/services/realtime/socketClient';
import { startRoomAudio } from './roomAudioService';
import { roomAudioSession, useRoomAudioStore } from './roomAudioSession';
import { ensureRoomSocketAdmission } from './roomSocketAdmission';

const mockReconnectHandlers: Array<() => void> = [];
const mockReconnectUnsubscribe = jest.fn();
const mockOnReconnect = jest.fn((handler: () => void) => {
  mockReconnectHandlers.push(handler);
  return mockReconnectUnsubscribe;
});

jest.mock('../../../shared/services/realtime/socketClient', () => ({
  getSocket: jest.fn(),
  onReconnect: (handler: () => void) => mockOnReconnect(handler),
  disconnectSocket: jest.fn(),
}));

jest.mock('../../../core/observability/reporter', () => ({
  reportException: jest.fn(),
}));

jest.mock('./roomAudioService', () => ({
  MIC_PERMISSION_DENIED_ERROR: 'mic permission denied',
  startRoomAudio: jest.fn(),
}));

jest.mock('./roomSocketAdmission', () => ({
  clearRoomSocketAdmission: jest.fn(),
  ensureRoomSocketAdmission: jest.fn().mockResolvedValue(undefined),
  RoomSocketAdmissionError: class RoomSocketAdmissionError extends Error {},
}));

const mockGetSocket = getSocket as jest.MockedFunction<typeof getSocket>;
const mockStartRoomAudio = startRoomAudio as jest.MockedFunction<typeof startRoomAudio>;
const mockEnsureAdmission = ensureRoomSocketAdmission as jest.MockedFunction<
  typeof ensureRoomSocketAdmission
>;

const socket = {
  id: 'socket-1',
  connected: true,
  on: jest.fn(),
  off: jest.fn(),
} as unknown as Socket;

const deferred = <T>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>(res => {
    resolve = res;
  });
  return { promise, resolve };
};

describe('roomAudioSession cancellation', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await roomAudioSession.stop();
    mockReconnectHandlers.length = 0;
    mockEnsureAdmission.mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await roomAudioSession.stop();
  });

  it('does not start an old room when stop wins the pending socket wait', async () => {
    const socketWait = deferred<Socket | null>();
    mockGetSocket.mockReturnValueOnce(socketWait.promise);

    const staleStart = roomAudioSession.start('room-old');
    await roomAudioSession.stop();

    socketWait.resolve(socket);
    await staleStart;

    expect(mockStartRoomAudio).not.toHaveBeenCalled();
    expect(useRoomAudioStore.getState()).toMatchObject({
      roomId: null,
      status: 'idle',
      error: null,
    });
  });

  it('surfaces a publication denial and clears it after a successful unmute retry', async () => {
    const publicationError = new Error('mic permission denied');
    const setMuted = jest
      .fn<Promise<void>, [boolean]>()
      .mockRejectedValueOnce(publicationError)
      .mockResolvedValueOnce(undefined);
    mockGetSocket.mockResolvedValue(socket);
    mockStartRoomAudio.mockResolvedValue({
      close: jest.fn().mockResolvedValue(undefined),
      setMuted,
      setPeerVolume: jest.fn(),
      setRole: jest.fn().mockResolvedValue(undefined),
      getPeers: jest.fn(() => new Map()),
    });
    await roomAudioSession.start('room-1');

    await expect(roomAudioSession.setMuted(false)).rejects.toBe(publicationError);
    expect(useRoomAudioStore.getState()).toMatchObject({
      roomId: 'room-1',
      status: 'error',
      error: 'mic permission denied',
    });

    await roomAudioSession.setMuted(false);
    expect(useRoomAudioStore.getState()).toMatchObject({
      status: 'live',
      error: null,
    });
  });

  it('retains a receive-only handle and surfaces an initial microphone denial', async () => {
    const setMuted = jest.fn().mockResolvedValue(undefined);
    mockGetSocket.mockResolvedValue(socket);
    mockStartRoomAudio.mockResolvedValue({
      initialMicPermissionDenied: true,
      close: jest.fn().mockResolvedValue(undefined),
      setMuted,
      setPeerVolume: jest.fn(),
      setRole: jest.fn().mockResolvedValue(undefined),
      getPeers: jest.fn(() => new Map()),
    });

    await roomAudioSession.start('room-1');

    expect(useRoomAudioStore.getState()).toMatchObject({
      roomId: 'room-1',
      status: 'error',
      error: 'mic permission denied',
    });
    await roomAudioSession.setMuted(false);
    expect(setMuted).toHaveBeenCalledWith(false);
    expect(useRoomAudioStore.getState()).toMatchObject({ status: 'live', error: null });
  });

  it('re-admits immediately after reconnect while only the persistent mini-bar remains', async () => {
    mockGetSocket.mockResolvedValue(socket);
    mockStartRoomAudio.mockResolvedValue({
      close: jest.fn().mockResolvedValue(undefined),
      setMuted: jest.fn().mockResolvedValue(undefined),
      setPeerVolume: jest.fn(),
      setRole: jest.fn().mockResolvedValue(undefined),
      getPeers: jest.fn(() => new Map()),
    });
    await roomAudioSession.start('room-mini');
    expect(mockReconnectHandlers).toHaveLength(1);

    mockEnsureAdmission.mockClear();
    (socket as Socket & { id: string }).id = 'socket-2';
    mockReconnectHandlers[0]?.();
    await Promise.resolve();
    await Promise.resolve();

    expect(mockEnsureAdmission).toHaveBeenCalledWith(socket, 'room-mini');
    expect(useRoomAudioStore.getState().roomId).toBe('room-mini');
  });

  it('closes an errored live handle before retrying the same room', async () => {
    const firstClose = jest.fn().mockResolvedValue(undefined);
    const secondClose = jest.fn().mockResolvedValue(undefined);
    const makeHandle = (close: jest.Mock) => ({
      close,
      setMuted: jest.fn().mockResolvedValue(undefined),
      setPeerVolume: jest.fn(),
      setRole: jest.fn().mockResolvedValue(undefined),
      getPeers: jest.fn(() => new Map()),
    });
    mockGetSocket.mockResolvedValue(socket);
    mockStartRoomAudio
      .mockResolvedValueOnce(makeHandle(firstClose))
      .mockResolvedValueOnce(makeHandle(secondClose));

    await roomAudioSession.start('room-1');
    mockStartRoomAudio.mock.calls[0]?.[0].onError?.(new Error('rejoin budget exhausted'));
    expect(useRoomAudioStore.getState()).toMatchObject({
      roomId: 'room-1',
      status: 'error',
      error: 'rejoin budget exhausted',
    });

    await Promise.all([roomAudioSession.retry('room-1'), roomAudioSession.retry('room-1')]);

    expect(firstClose).toHaveBeenCalledTimes(1);
    expect(mockStartRoomAudio).toHaveBeenCalledTimes(2);
    expect(useRoomAudioStore.getState()).toMatchObject({
      roomId: 'room-1',
      status: 'live',
      error: null,
    });
  });

  it('does not reopen a retry after an explicit stop wins pending cleanup', async () => {
    const closeWait = deferred<void>();
    mockGetSocket.mockResolvedValue(socket);
    mockStartRoomAudio.mockResolvedValue({
      close: jest.fn(() => closeWait.promise),
      setMuted: jest.fn().mockResolvedValue(undefined),
      setPeerVolume: jest.fn(),
      setRole: jest.fn().mockResolvedValue(undefined),
      getPeers: jest.fn(() => new Map()),
    });
    await roomAudioSession.start('room-1');

    const retry = roomAudioSession.retry('room-1');
    const explicitStop = roomAudioSession.stop();
    closeWait.resolve();
    await Promise.all([retry, explicitStop]);

    expect(mockStartRoomAudio).toHaveBeenCalledTimes(1);
    expect(useRoomAudioStore.getState()).toMatchObject({ roomId: null, status: 'idle' });
  });
});
