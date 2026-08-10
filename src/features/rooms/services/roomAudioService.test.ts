import type { Socket } from 'socket.io-client';
import { requestAudioPermission } from '../../../shared/utils/permissions';
import { roomService } from './roomService';
import {
  connectLiveKitRoom,
  disconnectLiveKitRoom,
  setLiveKitMuted,
  startLiveKitAudioSession,
  stopLiveKitAudioSession,
} from './livekit/LiveKitEngine';
import { startRoomForeground, stopRoomForeground } from './foregroundAudio';
import { MIC_PERMISSION_DENIED_ERROR, startRoomAudio } from './roomAudioService';

const mockRoom = {
  on: jest.fn(),
  off: jest.fn(),
  remoteParticipants: new Map(),
};

jest.mock('../../../shared/utils/permissions', () => ({
  requestAudioPermission: jest.fn(),
}));

jest.mock('../../auth/store/authStore', () => ({
  useAuthStore: {
    getState: () => ({ user: { id: 'viewer-1' } }),
  },
}));

jest.mock('../store/currentRoomStore', () => ({
  useCurrentRoomStore: {
    getState: () => ({ isMuted: true }),
  },
}));

jest.mock('./roomService', () => ({
  roomService: {
    getLivekitToken: jest.fn(),
  },
}));

jest.mock('./livekit/LiveKitEngine', () => ({
  LIVEKIT_UNAVAILABLE_SENTINEL: 'livekit unavailable',
  createLiveKitRoom: jest.fn(() => mockRoom),
  connectLiveKitRoom: jest.fn().mockResolvedValue(undefined),
  disconnectLiveKitRoom: jest.fn(),
  getLiveKitEvents: jest.fn(() => ({
    ParticipantConnected: 'participant-connected',
    ParticipantDisconnected: 'participant-disconnected',
    ActiveSpeakersChanged: 'active-speakers-changed',
    Disconnected: 'disconnected',
    Reconnecting: 'reconnecting',
    Reconnected: 'reconnected',
  })),
  mapLiveKitConnectionState: jest.fn(() => 'connected'),
  setLiveKitMuted: jest.fn().mockResolvedValue(undefined),
  startLiveKitAudioSession: jest.fn().mockResolvedValue(undefined),
  stopLiveKitAudioSession: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('./foregroundAudio', () => ({
  startRoomForeground: jest.fn().mockResolvedValue(undefined),
  stopRoomForeground: jest.fn().mockResolvedValue(undefined),
}));

const mockPermission = requestAudioPermission as jest.MockedFunction<typeof requestAudioPermission>;
const mockToken = roomService.getLivekitToken as jest.MockedFunction<
  typeof roomService.getLivekitToken
>;
const mockConnect = connectLiveKitRoom as jest.MockedFunction<typeof connectLiveKitRoom>;
const mockSetLiveKitMuted = setLiveKitMuted as jest.MockedFunction<typeof setLiveKitMuted>;

const socket = {
  on: jest.fn(),
  off: jest.fn(),
} as unknown as Socket;

const tokenResponse = (canPublish: boolean) => ({
  token: 'signed-token',
  url: 'ws://127.0.0.1:7880',
  room: 'room-1',
  identity: 'viewer-1',
  canPublish,
  expiresAt: '',
  expiresInSec: 3600,
});

const deferred = <T>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

describe('startRoomAudio microphone capability', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPermission.mockResolvedValue(true);
    mockConnect.mockResolvedValue(undefined);
    mockSetLiveKitMuted.mockReset().mockResolvedValue(undefined);
  });

  it('connects a receive-only listener without requesting RECORD_AUDIO', async () => {
    mockToken.mockResolvedValue(tokenResponse(false));

    const handle = await startRoomAudio({ socket, roomId: 'room-1' });

    expect(mockPermission).not.toHaveBeenCalled();
    expect(startLiveKitAudioSession).toHaveBeenCalledTimes(1);
    expect(mockConnect).toHaveBeenCalledWith(mockRoom, 'ws://127.0.0.1:7880', 'signed-token');

    await handle.close();
  });

  it('requests the microphone only for a publisher and fails before connect when denied', async () => {
    mockToken.mockResolvedValue(tokenResponse(true));
    mockPermission.mockResolvedValue(false);

    await expect(startRoomAudio({ socket, roomId: 'room-1' })).rejects.toThrow(
      MIC_PERMISSION_DENIED_ERROR,
    );

    expect(mockPermission).toHaveBeenCalledTimes(1);
    expect(mockConnect).not.toHaveBeenCalled();
    expect(stopLiveKitAudioSession).toHaveBeenCalledTimes(1);
  });

  it('maps a LiveKit permission publication error to the mic-denied UI contract', async () => {
    mockToken.mockResolvedValue(tokenResponse(false));
    const handle = await startRoomAudio({ socket, roomId: 'room-1' });
    const publicationError = Object.assign(new Error('GetUserMedia Permission denied'), {
      name: 'NotAllowedError',
    });
    mockSetLiveKitMuted.mockRejectedValueOnce(publicationError);

    await expect(handle.setMuted(false)).rejects.toThrow(MIC_PERMISSION_DENIED_ERROR);

    await handle.close();
  });

  it('preserves a non-permission LiveKit publication error', async () => {
    mockToken.mockResolvedValue(tokenResponse(false));
    const handle = await startRoomAudio({ socket, roomId: 'room-1' });
    const deviceError = new Error('audio device is busy');
    mockSetLiveKitMuted.mockRejectedValueOnce(deviceError);

    await expect(handle.setMuted(false)).rejects.toBe(deviceError);

    await handle.close();
  });

  it('surfaces a denied microphone when a listener is promoted to speaker', async () => {
    mockToken.mockResolvedValueOnce(tokenResponse(false));
    const onError = jest.fn();
    const handle = await startRoomAudio({ socket, roomId: 'room-1', onError });
    mockToken.mockResolvedValueOnce(tokenResponse(true));
    mockPermission.mockResolvedValueOnce(false);
    const roleChanged = (socket.on as jest.Mock).mock.calls.find(
      ([event]) => event === 'room:role_changed',
    )?.[1] as
      | ((payload: { userId: string; role: string; roomId: string }) => Promise<void>)
      | undefined;

    await roleChanged?.({ userId: 'viewer-1', role: 'SPEAKER', roomId: 'room-1' });

    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: MIC_PERMISSION_DENIED_ERROR }),
    );
    await handle.close();
  });

  it('rolls back a token failure and lets a retry own one clean listener/session set', async () => {
    const tokenError = new Error('token unavailable');
    mockToken.mockRejectedValueOnce(tokenError).mockResolvedValueOnce(tokenResponse(false));

    await expect(startRoomAudio({ socket, roomId: 'room-1' })).rejects.toBe(tokenError);

    expect(startLiveKitAudioSession).toHaveBeenCalledTimes(1);
    expect(stopLiveKitAudioSession).toHaveBeenCalledTimes(1);
    expect(startRoomForeground).not.toHaveBeenCalled();
    expect(stopRoomForeground).toHaveBeenCalledTimes(1);
    expect(disconnectLiveKitRoom).toHaveBeenCalledTimes(1);
    expect(mockRoom.on).not.toHaveBeenCalled();
    expect(socket.on).not.toHaveBeenCalled();

    const handle = await startRoomAudio({ socket, roomId: 'room-1' });

    expect(startLiveKitAudioSession).toHaveBeenCalledTimes(2);
    expect(stopLiveKitAudioSession).toHaveBeenCalledTimes(1);
    expect(mockRoom.on).toHaveBeenCalledTimes(6);
    expect(mockRoom.off).not.toHaveBeenCalled();
    expect(socket.on).toHaveBeenCalledTimes(3);
    expect(socket.off).not.toHaveBeenCalled();

    await handle.close();
    await handle.close();

    expect(stopLiveKitAudioSession).toHaveBeenCalledTimes(2);
    expect(stopRoomForeground).toHaveBeenCalledTimes(2);
    expect(disconnectLiveKitRoom).toHaveBeenCalledTimes(2);
    expect(mockRoom.off).toHaveBeenCalledTimes(6);
    expect(socket.off).toHaveBeenCalledTimes(3);
  });

  it('detaches a failed connect attempt before retrying without duplicate listeners', async () => {
    const connectError = new Error('livekit connect failed');
    mockToken.mockResolvedValue(tokenResponse(false));
    mockConnect.mockRejectedValueOnce(connectError).mockResolvedValue(undefined);

    await expect(startRoomAudio({ socket, roomId: 'room-1' })).rejects.toBe(connectError);

    const firstRoomBindings = mockRoom.on.mock.calls.map(call => [...call]);
    const firstSocketBindings = (socket.on as jest.Mock).mock.calls.map(call => [...call]);
    expect(firstRoomBindings).toHaveLength(6);
    expect(firstSocketBindings).toHaveLength(3);
    for (const binding of firstRoomBindings) {
      expect(mockRoom.off).toHaveBeenCalledWith(...binding);
    }
    for (const binding of firstSocketBindings) {
      expect(socket.off).toHaveBeenCalledWith(...binding);
    }
    expect(startLiveKitAudioSession).toHaveBeenCalledTimes(1);
    expect(stopLiveKitAudioSession).toHaveBeenCalledTimes(1);
    expect(disconnectLiveKitRoom).toHaveBeenCalledTimes(1);
    expect(stopRoomForeground).toHaveBeenCalledTimes(1);

    const handle = await startRoomAudio({ socket, roomId: 'room-1' });

    // One detached failed set + one currently active successful set.
    expect(mockRoom.on).toHaveBeenCalledTimes(12);
    expect(mockRoom.off).toHaveBeenCalledTimes(6);
    expect(socket.on).toHaveBeenCalledTimes(6);
    expect(socket.off).toHaveBeenCalledTimes(3);
    expect(startLiveKitAudioSession).toHaveBeenCalledTimes(2);
    expect(stopLiveKitAudioSession).toHaveBeenCalledTimes(1);

    await handle.close();

    expect(mockRoom.off).toHaveBeenCalledTimes(12);
    expect(socket.off).toHaveBeenCalledTimes(6);
    expect(stopLiveKitAudioSession).toHaveBeenCalledTimes(2);
    expect(stopRoomForeground).toHaveBeenCalledTimes(2);
    expect(disconnectLiveKitRoom).toHaveBeenCalledTimes(2);
  });

  it('rolls back when the owning session is cancelled during LiveKit connect', async () => {
    const connect = deferred<void>();
    const connectCalled = deferred<void>();
    let cancelled = false;
    mockToken.mockResolvedValue(tokenResponse(false));
    mockConnect.mockImplementationOnce(() => {
      connectCalled.resolve();
      return connect.promise;
    });

    const pending = startRoomAudio({
      socket,
      roomId: 'room-1',
      isCancelled: () => cancelled,
    });
    await connectCalled.promise;
    expect(mockConnect).toHaveBeenCalledTimes(1);

    cancelled = true;
    connect.resolve();

    await expect(pending).rejects.toThrow('room audio start cancelled');
    expect(startRoomForeground).not.toHaveBeenCalled();
    expect(stopLiveKitAudioSession).toHaveBeenCalledTimes(1);
    expect(stopRoomForeground).toHaveBeenCalledTimes(1);
    expect(disconnectLiveKitRoom).toHaveBeenCalled();
  });
});
