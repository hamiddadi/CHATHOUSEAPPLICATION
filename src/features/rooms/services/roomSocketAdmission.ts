import type { Socket } from 'socket.io-client';

const ADMISSION_ACK_TIMEOUT_MS = 10_000;

interface AdmissionEntry {
  socketId: string;
  promise: Promise<void>;
  cancel: () => void;
}

const admissions = new Map<string, AdmissionEntry>();

export type RoomSocketAdmissionFailure = 'denied' | 'timeout' | 'superseded' | 'disconnected';

export class RoomSocketAdmissionError extends Error {
  constructor(readonly reason: RoomSocketAdmissionFailure) {
    super(`room socket admission ${reason}`);
    this.name = 'RoomSocketAdmissionError';
  }
}

/**
 * One shared barrier for Socket.IO room membership and every LiveKit token
 * request. Concurrent screen/audio callers share one ack; after a transport
 * reconnect Socket.IO assigns a new id, which automatically forces a fresh
 * room:join before audio may obtain or renew a provider capability.
 */
export const ensureRoomSocketAdmission = async (socket: Socket, roomId: string): Promise<void> => {
  const socketId = socket.id;
  if (!socket.connected || !socketId) throw new RoomSocketAdmissionError('disconnected');

  const existing = admissions.get(roomId);
  if (existing?.socketId === socketId) return existing.promise;
  if (existing) {
    admissions.delete(roomId);
    existing.cancel();
  }

  let timer: ReturnType<typeof setTimeout> | null = null;
  let resolvePromise: () => void = () => undefined;
  let rejectPromise: (error: Error) => void = () => undefined;
  const promise = new Promise<void>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  const entry: AdmissionEntry = {
    socketId,
    promise,
    cancel: () => {
      if (timer) clearTimeout(timer);
      timer = null;
      rejectPromise(new RoomSocketAdmissionError('superseded'));
    },
  };
  admissions.set(roomId, entry);
  timer = setTimeout(
    () => rejectPromise(new RoomSocketAdmissionError('timeout')),
    ADMISSION_ACK_TIMEOUT_MS,
  );
  socket.emit('room:join', { roomId }, (ok: boolean) => {
    if (timer) clearTimeout(timer);
    timer = null;
    if (admissions.get(roomId) !== entry) {
      rejectPromise(new RoomSocketAdmissionError('superseded'));
      return;
    }
    if (ok) resolvePromise();
    else rejectPromise(new RoomSocketAdmissionError('denied'));
  });

  try {
    await promise;
  } catch (error) {
    if (admissions.get(roomId) === entry) admissions.delete(roomId);
    throw error;
  }
};

/** Explicit leave/kick/end invalidates the same-socket success cache. */
export const clearRoomSocketAdmission = (roomId: string): void => {
  const entry = admissions.get(roomId);
  admissions.delete(roomId);
  entry?.cancel();
};

export const _resetRoomSocketAdmissionsForTests = (): void => {
  for (const entry of admissions.values()) entry.cancel();
  admissions.clear();
};
