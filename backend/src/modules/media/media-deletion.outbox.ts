import type { OutboxEvent, Prisma } from '@prisma/client';
import { prisma } from '../../config/database';
import { registerOutboxHandler, wakeAndProcessOutbox } from '../../workers/outbox.worker';
import { privateObjectStore } from './object-storage';

export const MEDIA_OBJECT_DELETE_TOPIC = 'media.object.delete';

interface MediaDeletionPayload {
  mediaId: string;
  storageKey?: string;
  deleted?: true;
}

/**
 * Durable deletion authorization written in the same transaction that removes
 * the MediaObject/user rows. Until this envelope commits, no storage consumer
 * can observe the key and therefore no bytes can be deleted.
 */
export const mediaDeletionOutboxData = (media: {
  id: string;
  storageKey: string;
}): Prisma.OutboxEventCreateManyInput => ({
  eventKey: `${MEDIA_OBJECT_DELETE_TOPIC}:${media.id}`,
  topic: MEDIA_OBJECT_DELETE_TOPIC,
  aggregateId: media.id,
  payload: { mediaId: media.id, storageKey: media.storageKey },
});

const payloadOf = (event: OutboxEvent): MediaDeletionPayload => {
  if (!event.payload || typeof event.payload !== 'object' || Array.isArray(event.payload)) {
    throw new Error('Invalid media deletion outbox payload');
  }
  const payload = event.payload as Record<string, unknown>;
  if (Object.keys(payload).some(key => !['mediaId', 'storageKey', 'deleted'].includes(key))) {
    throw new Error('Invalid media deletion outbox payload');
  }
  const mediaId = payload['mediaId'];
  const storageKey = payload['storageKey'];
  const deleted = payload['deleted'];
  if (typeof mediaId !== 'string' || mediaId.length === 0 || event.aggregateId !== mediaId) {
    throw new Error('Missing mediaId in outbox payload');
  }
  if (storageKey !== undefined && (typeof storageKey !== 'string' || storageKey.length === 0)) {
    throw new Error('Invalid storageKey in media deletion outbox payload');
  }
  if (deleted !== undefined && deleted !== true) {
    throw new Error('Invalid deleted marker in media deletion outbox payload');
  }
  if (typeof storageKey === 'string' && deleted === true) {
    throw new Error('Invalid media deletion outbox payload');
  }
  if (storageKey === undefined && deleted !== true) {
    throw new Error('Missing storageKey in media deletion outbox payload');
  }
  return {
    mediaId,
    ...(typeof storageKey === 'string' ? { storageKey } : {}),
    ...(deleted === true ? { deleted: true as const } : {}),
  };
};

const deliverMediaDeletion = async (event: OutboxEvent): Promise<void> => {
  const { mediaId, storageKey, deleted } = payloadOf(event);
  // A replay after successful deletion observes the redacted payload and is a
  // successful no-op. Object-store deletion itself is idempotent as well, so a
  // lost response before redaction safely retries the same key.
  if (deleted) return;
  // payloadOf fails closed when neither a key nor an explicit durable
  // completion marker is present.
  if (!storageKey) throw new Error('Missing storageKey in media deletion outbox payload');

  await privateObjectStore.delete(storageKey);

  // Do not retain a storage key containing the erased user's former id for the
  // normal delivered-outbox retention period. If this SQL update fails, the
  // handler fails and retries the already-idempotent object deletion.
  await prisma.outboxEvent.update({
    where: { id: event.id },
    data: { payload: { mediaId, deleted: true } },
  });
};

registerOutboxHandler(MEDIA_OBJECT_DELETE_TOPIC, deliverMediaDeletion);

export const wakeMediaDeletion = (mediaId: string): Promise<number> =>
  wakeAndProcessOutbox(MEDIA_OBJECT_DELETE_TOPIC, mediaId);

export const _internals = { deliverMediaDeletion };
