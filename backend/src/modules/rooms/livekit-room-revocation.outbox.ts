import type { OutboxEvent, Prisma } from '@prisma/client';
import { prisma } from '../../config/database';
import { registerOutboxHandler, wakeAndProcessOutbox } from '../../workers/outbox.worker';
import { livekitService } from './livekit.service';
import { requireLivekitCredentialDrain } from './livekit-revocation.outbox';

export const LIVEKIT_ROOM_REVOCATION_TOPIC = 'livekit.room.revoke';

type LivekitRoomRevocationPayload = { roomId: string };

export const livekitRoomRevocationOutboxData = (
  roomId: string,
  transitionId: string,
): Prisma.OutboxEventCreateManyInput => ({
  eventKey: transitionId,
  topic: LIVEKIT_ROOM_REVOCATION_TOPIC,
  // A room is not personal data and is the useful wake-up aggregate when a
  // provision attempt races an already-committed room closure.
  aggregateId: roomId,
  payload: { roomId },
});

const payloadOf = (event: OutboxEvent): LivekitRoomRevocationPayload => {
  if (!event.payload || typeof event.payload !== 'object' || Array.isArray(event.payload)) {
    throw new Error('Invalid LiveKit room revocation outbox payload');
  }
  const roomId = (event.payload as Record<string, unknown>)['roomId'];
  if (typeof roomId !== 'string' || roomId.length === 0) {
    throw new Error('Missing roomId in LiveKit room revocation outbox payload');
  }
  return { roomId };
};

export const deliverLivekitRoomRevocation = async (event: OutboxEvent): Promise<void> => {
  const { roomId } = payloadOf(event);
  const room = await prisma.room.findUnique({
    where: { id: roomId },
    select: { isLive: true, endedAt: true },
  });
  // A stale envelope must never delete a currently-live provider room.
  if (room?.isLive && !room.endedAt) return;
  if (!livekitService.isConfigured()) return;

  await livekitService.deleteRoom(roomId);
  await requireLivekitCredentialDrain(event);
};

registerOutboxHandler(LIVEKIT_ROOM_REVOCATION_TOPIC, deliverLivekitRoomRevocation);

export const wakeLivekitRoomRevocation = (roomId: string): Promise<number> =>
  wakeAndProcessOutbox(LIVEKIT_ROOM_REVOCATION_TOPIC, roomId);
