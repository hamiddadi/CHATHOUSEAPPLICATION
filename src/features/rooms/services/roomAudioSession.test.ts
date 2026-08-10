import type { Socket } from 'socket.io-client';
import { getSocket } from '../../../shared/services/realtime/socketClient';
import { startRoomAudio } from './roomAudioService';
import { roomAudioSession, useRoomAudioStore } from './roomAudioSession';

jest.mock('../../../shared/services/realtime/socketClient', () => ({
  getSocket: jest.fn(),
  disconnectSocket: jest.fn(),
}));

jest.mock('../../../core/observability/reporter', () => ({
  reportException: jest.fn(),
}));

jest.mock('./roomAudioService', () => ({
  MIC_PERMISSION_DENIED_ERROR: 'mic permission denied',
  startRoomAudio: jest.fn(),
}));

const mockGetSocket = getSocket as jest.MockedFunction<typeof getSocket>;
const mockStartRoomAudio = startRoomAudio as jest.MockedFunction<typeof startRoomAudio>;

const socket = {
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
});
