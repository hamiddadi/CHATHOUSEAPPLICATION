import type { OutboxEvent, Prisma } from '@prisma/client';
import { redis } from '../config/redis';
import { registerOutboxHandler } from '../workers/outbox.worker';

export const CLUB_EXTENSION_CLEANUP_TOPIC = 'club.extension.cleanup';
export type ClubExtensionCleanupScope = 'metadata' | 'all';
export const clubDeletionTombstoneKey = (clubId: string): string => `ext:club:deleted:${clubId}`;

export const clubExtensionCleanupOutboxData = (
  clubId: string,
  scope: ClubExtensionCleanupScope,
): Prisma.OutboxEventCreateManyInput => ({
  eventKey: `${CLUB_EXTENSION_CLEANUP_TOPIC}:${scope}:${clubId}`,
  topic: CLUB_EXTENSION_CLEANUP_TOPIC,
  aggregateId: clubId,
  payload: { clubId, scope },
});

const payloadOf = (event: OutboxEvent): { clubId: string; scope: ClubExtensionCleanupScope } => {
  if (!event.payload || typeof event.payload !== 'object' || Array.isArray(event.payload)) {
    throw new Error('Invalid club extension cleanup outbox payload');
  }
  const payload = event.payload as Record<string, unknown>;
  const clubId = payload['clubId'];
  const scope = payload['scope'];
  if (typeof clubId !== 'string' || clubId.length === 0 || event.aggregateId !== clubId) {
    throw new Error('Missing clubId in outbox payload');
  }
  if (scope !== 'metadata' && scope !== 'all') {
    throw new Error('Invalid club cleanup scope in outbox payload');
  }
  return { clubId, scope };
};

const deliverClubExtensionCleanup = async (event: OutboxEvent): Promise<void> => {
  const { clubId, scope } = payloadOf(event);
  const metadataKeys = [`ext:clubmeta:${clubId}`, `ext:clubmeta:featured:${clubId}`];
  if (scope === 'metadata') {
    await redis.del(metadataKeys);
    return;
  }

  const requestIndexKey = `ext:clubreq:club:${clubId}`;
  // Publish the tombstone before enumerating. Redis commands and Lua scripts
  // are serialized: a request either completes before this SET and is included
  // below, or observes the tombstone and refuses to recreate club-scoped data.
  // Club ids are never reused, so this small marker is intentionally durable.
  await redis.set(clubDeletionTombstoneKey(clubId), '1');
  const pendingUserIds = await redis.sMembers(requestIndexKey);
  await redis.del([
    requestIndexKey,
    ...pendingUserIds.map(userId => `ext:clubreq:${clubId}:${userId}`),
    ...metadataKeys,
  ]);
};

registerOutboxHandler(CLUB_EXTENSION_CLEANUP_TOPIC, deliverClubExtensionCleanup);

export const _internals = { deliverClubExtensionCleanup };
