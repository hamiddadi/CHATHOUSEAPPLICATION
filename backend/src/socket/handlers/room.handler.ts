import type { Server, Socket } from 'socket.io';
import { materializePrivateMediaUrls } from '../../modules/media/media-url';
import { roomsService } from '../../modules/rooms/rooms.service';
import { logger } from '../../config/logger';
import { roomChannel } from '../channels';
import { emitMapUserUpdate } from '../realtime';
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
    const joiningUserId = userId();
    let joinedChannel = false;
    let admission: Awaited<ReturnType<typeof roomsService.join>>['admission'] = null;
    try {
      const room = await roomsService.join(payload.roomId, joiningUserId);
      admission = room.admission;
      await socket.join(roomChannel(payload.roomId));
      joinedChannel = true;
      const confirmed = await roomsService.confirmSocketAdmission(payload.roomId, joiningUserId);
      if (!confirmed) throw new Error('Socket room admission is no longer active');

      io.to(roomChannel(payload.roomId)).emit('room:user-joined', {
        userId: joiningUserId,
        roomId: payload.roomId,
      });
      // Bridge to the map: joiners enter as listeners (blue hearing badge);
      // setMute later flips them to speaking/muted if they take the stage.
      await emitMapUserUpdate({
        userId: joiningUserId,
        isInRoom: true,
        isListener: true,
      }).catch(err => logger.warn('room:join map presence update failed', { err }));
      socket.emit(
        'room:participants',
        materializePrivateMediaUrls({ participants: room.participants }),
      );
      ack?.(true);
    } catch (err) {
      logger.warn('room:join failed', { err });
      if (joinedChannel) {
        try {
          await socket.leave(roomChannel(payload.roomId));
        } catch (leaveErr) {
          logger.warn('room:join channel compensation failed', { err: leaveErr });
        }
      }
      if (admission) {
        await roomsService
          .compensateUnconfirmedAdmission(payload.roomId, joiningUserId, admission)
          .catch(compensationErr =>
            logger.warn('room:join database compensation failed', { err: compensationErr }),
          );
      }
      ack?.(false);
    }
  });

  socket.on('room:leave', async (payload: LeavePayload, ack?: (ok: boolean) => void) => {
    try {
      await roomsService.leave(payload.roomId, userId());
      await socket.leave(roomChannel(payload.roomId));
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
