import type { Socket } from 'socket.io-client';
import {
  _resetRoomSocketAdmissionsForTests,
  clearRoomSocketAdmission,
  ensureRoomSocketAdmission,
  RoomSocketAdmissionError,
} from './roomSocketAdmission';

interface MutableSocket {
  id: string;
  connected: boolean;
  emit: jest.Mock;
}

describe('room Socket.IO admission barrier', () => {
  let socket: MutableSocket;
  let acknowledgements: Array<(ok: boolean) => void>;

  beforeEach(() => {
    _resetRoomSocketAdmissionsForTests();
    acknowledgements = [];
    socket = {
      id: 'socket-1',
      connected: true,
      emit: jest.fn((_event, _payload, ack: (ok: boolean) => void) => {
        acknowledgements.push(ack);
        return socket;
      }),
    };
  });

  afterEach(() => {
    _resetRoomSocketAdmissionsForTests();
  });

  it('deduplicates concurrent admission callers on the same socket', async () => {
    const first = ensureRoomSocketAdmission(socket as unknown as Socket, 'room-1');
    const second = ensureRoomSocketAdmission(socket as unknown as Socket, 'room-1');
    expect(socket.emit).toHaveBeenCalledTimes(1);

    acknowledgements[0]?.(true);
    await expect(Promise.all([first, second])).resolves.toEqual([undefined, undefined]);
  });

  it('accepts an acknowledgement delivered synchronously by a socket adapter', async () => {
    socket.emit.mockImplementation((_event, _payload, ack: (ok: boolean) => void) => {
      ack(true);
      return socket;
    });

    await expect(
      ensureRoomSocketAdmission(socket as unknown as Socket, 'room-sync'),
    ).resolves.toBeUndefined();
    expect(socket.emit).toHaveBeenCalledTimes(1);
  });

  it('rejects the old attempt as superseded and accepts the reconnect ack', async () => {
    const oldAttempt = ensureRoomSocketAdmission(socket as unknown as Socket, 'room-1');
    socket.id = 'socket-2';
    const newAttempt = ensureRoomSocketAdmission(socket as unknown as Socket, 'room-1');

    await expect(oldAttempt).rejects.toMatchObject<Partial<RoomSocketAdmissionError>>({
      reason: 'superseded',
    });
    acknowledgements[0]?.(false);
    acknowledgements[1]?.(true);
    await expect(newAttempt).resolves.toBeUndefined();
  });

  it('invalidates a pending same-socket success on explicit leave', async () => {
    const pending = ensureRoomSocketAdmission(socket as unknown as Socket, 'room-1');
    clearRoomSocketAdmission('room-1');
    acknowledgements[0]?.(true);
    await expect(pending).rejects.toMatchObject<Partial<RoomSocketAdmissionError>>({
      reason: 'superseded',
    });
  });
});
