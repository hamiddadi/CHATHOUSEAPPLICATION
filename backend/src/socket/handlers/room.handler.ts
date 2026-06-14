import type { Server, Socket } from 'socket.io';
import { roomsService } from '../../modules/rooms/rooms.service';
import { logger } from '../../config/logger';
import {
  closeRoom as closeSfuRoom,
  closeProducersForUserInRoom,
} from '../../webrtc/mediasoup.manager';
import { roomChannel } from '../channels';
import { getUserId } from '../socket.middleware';

interface JoinPayload {
  roomId: string;
}
interface LeavePayload {
  roomId: string;
}
interface MutePayload {
  roomId: string;
  isMuted: boolean;
}
interface EndPayload {
  roomId: string;
}
interface SpeakRequestPayload {
  roomId: string;
}

/**
 * Events mirror the spec in the original prompt:
 *  - room:join / leave / mute / request-speak / end
 *  - server broadcasts: user-joined, user-left, mute-changed, role-changed,
 *    speak-request, ended
 * mediasoup audio events (rtc:*) are not wired in Phase 3 — see docs.
 */
export const registerRoomHandlers = (io: Server, socket: Socket): void => {
  const userId = (): string => getUserId(socket);

  socket.on('room:join', async (payload: JoinPayload, ack?: (ok: boolean) => void) => {
    try {
      const room = await roomsService.join(payload.roomId, userId());
      await socket.join(roomChannel(payload.roomId));
      io.to(roomChannel(payload.roomId)).emit('room:user-joined', {
        userId: userId(),
        roomId: payload.roomId,
      });
      socket.emit('room:participants', { participants: room.participants });
      ack?.(true);
    } catch (err) {
      logger.warn('room:join failed', { err });
      ack?.(false);
    }
  });

  socket.on('room:leave', async (payload: LeavePayload, ack?: (ok: boolean) => void) => {
    try {
      await roomsService.leave(payload.roomId, userId());
      // Close any RTC producer this user had in this room — the Producer's
      // `close` handler fans out `rtc:producer-closed` so peers stop consuming.
      closeProducersForUserInRoom(payload.roomId, userId());
      await socket.leave(roomChannel(payload.roomId));
      io.to(roomChannel(payload.roomId)).emit('room:user-left', {
        userId: userId(),
        roomId: payload.roomId,
      });
      ack?.(true);
    } catch (err) {
      logger.warn('room:leave failed', { err });
      ack?.(false);
    }
  });

  socket.on('room:mute', async (payload: MutePayload, ack?: (ok: boolean) => void) => {
    try {
      const result = await roomsService.setMute(payload.roomId, userId(), {
        isMuted: payload.isMuted,
      });
      io.to(roomChannel(payload.roomId)).emit('room:mute-changed', result);
      ack?.(true);
    } catch (err) {
      logger.warn('room:mute failed', { err });
      ack?.(false);
    }
  });

  socket.on(
    'room:request-speak',
    async (payload: SpeakRequestPayload, ack?: (ok: boolean) => void) => {
      try {
        // HAND-07 fix: delegate to the REST `raiseHand` path so the request is
        // actually persisted in the RoomHandRaise FIFO queue (and the host's
        // hand-raise list). Previously this socket only broadcast an ephemeral
        // `room:speak-request` and persisted nothing, diverging from REST.
        // `raiseHand` enforces room-state + active-participant guards and emits
        // `room:hand_raised` itself.
        await roomsService.raiseHand(payload.roomId, userId());
        ack?.(true);
      } catch (err) {
        logger.warn('room:request-speak failed', { err });
        ack?.(false);
      }
    },
  );

  socket.on('room:end', async (payload: EndPayload, ack?: (ok: boolean) => void) => {
    try {
      await roomsService.end(payload.roomId, userId());
      // Release the SFU router + all producers for this room. `closeSfuRoom`
      // is idempotent so it's safe if RTC wasn't in use for this room.
      await closeSfuRoom(payload.roomId);
      // ROOM-06 fix: do NOT emit `room:ended` here — `roomsService.end()`
      // already broadcasts it via `emitRoomEnded`. Emitting again duplicated
      // the event for every client in the room.
      ack?.(true);
    } catch (err) {
      logger.warn('room:end failed', { err });
      ack?.(false);
    }
  });
};
