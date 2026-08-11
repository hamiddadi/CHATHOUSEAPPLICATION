import type { OutboxEvent, Prisma } from '@prisma/client';
import { prisma } from '../../config/database';
import { LIVEKIT_TOKEN_MAX_TTL_SECONDS } from '../../config/env';
import { registerOutboxHandler, wakeAndProcessOutbox } from '../../workers/outbox.worker';
import {
  enforceLivekitParticipantPolicyLocked,
  type LivekitParticipantPolicyEffect as CoreLivekitParticipantPolicyEffect,
  type LivekitParticipantPolicyStore,
} from '../../workers/livekitParticipantPolicy.core';
import { currentLegalDocumentVersion, legalAcceptanceSelect } from '../auth/legal-acceptance';
import { livekitService } from './livekit.service';

export const LIVEKIT_REVOCATION_TOPIC = 'livekit.participant.revoke';
const LIVEKIT_PROVIDER_REFRESH_TTL_SECONDS = 10 * 60;
export const LIVEKIT_REVOCATION_CONFIRMATION_MS =
  (Math.max(LIVEKIT_TOKEN_MAX_TTL_SECONDS, LIVEKIT_PROVIDER_REFRESH_TTL_SECONDS) + 10) * 1_000;

class LivekitRevocationWindowOpenError extends Error {
  constructor() {
    super('Pre-revocation LiveKit credentials have not all expired');
    this.name = 'LivekitRevocationWindowOpen';
  }
}

/**
 * Anchor the credential-drain horizon on the first confirmed provider effect,
 * not event creation. An outage before that success must never consume the
 * safety window. The caller invokes this only after a successful remove /
 * permission update; returning means that call was the final post-horizon one.
 */
export const requireLivekitCredentialDrain = async (event: OutboxEvent): Promise<void> => {
  const now = new Date();
  if (!event.effectStartedAt) {
    await prisma.outboxEvent.updateMany({
      where: { id: event.id, deliveredAt: null, effectStartedAt: null },
      data: { effectStartedAt: now },
    });
    throw new LivekitRevocationWindowOpenError();
  }
  if (now.getTime() < event.effectStartedAt.getTime() + LIVEKIT_REVOCATION_CONFIRMATION_MS) {
    throw new LivekitRevocationWindowOpenError();
  }
};

type LivekitRevocationPayload = {
  roomId: string;
  userId: string;
};

/**
 * Build the durable provider hand-off inside the same transaction as the
 * application-level access revocation. The transition id is a fresh opaque
 * UUID: it identifies this exact active -> revoked transition without putting
 * either personal identifier in the outbox key or aggregate.
 */
export const livekitRevocationOutboxData = (
  payload: LivekitRevocationPayload,
  transitionId: string,
): Prisma.OutboxEventCreateManyInput => ({
  eventKey: transitionId,
  topic: LIVEKIT_REVOCATION_TOPIC,
  aggregateId: transitionId,
  payload,
});

const payloadOf = (event: OutboxEvent): LivekitRevocationPayload => {
  if (!event.payload || typeof event.payload !== 'object' || Array.isArray(event.payload)) {
    throw new Error('Invalid LiveKit revocation outbox payload');
  }
  const payload = event.payload as Record<string, unknown>;
  if (typeof payload['roomId'] !== 'string' || payload['roomId'].length === 0) {
    throw new Error('Missing roomId in LiveKit revocation outbox payload');
  }
  if (typeof payload['userId'] !== 'string' || payload['userId'].length === 0) {
    throw new Error('Missing userId in LiveKit revocation outbox payload');
  }
  return { roomId: payload['roomId'], userId: payload['userId'] };
};

export type LivekitParticipantPolicyEffect =
  | { kind: 'unconfigured' }
  | CoreLivekitParticipantPolicyEffect;

const participantPolicyStore: LivekitParticipantPolicyStore<Prisma.TransactionClient> = {
  transaction: (work, options) => prisma.$transaction(work, options),
  setLocalLockTimeout: async (tx, milliseconds) => {
    await tx.$queryRaw`SELECT set_config('lock_timeout', ${`${milliseconds}ms`}, true)`;
  },
  lockRoom: async (tx, roomId) => {
    await tx.$queryRaw`SELECT "id" FROM "Room" WHERE "id" = ${roomId} FOR UPDATE`;
  },
  lockUser: async (tx, userId) => {
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
  },
  lockParticipant: async (tx, roomId, userId) => {
    await tx.$queryRaw`SELECT "id" FROM "Participant" WHERE "roomId" = ${roomId} AND "userId" = ${userId} FOR UPDATE`;
  },
  readRoom: (tx, roomId) =>
    tx.room.findUnique({
      where: { id: roomId },
      select: { hostId: true, isLive: true, endedAt: true },
    }),
  readUser: (tx, userId) =>
    tx.user.findUnique({
      where: { id: userId },
      select: { deletedAt: true, suspendedUntil: true, ...legalAcceptanceSelect },
    }),
  readParticipant: (tx, roomId, userId) =>
    tx.participant.findUnique({
      where: { userId_roomId: { roomId, userId } },
      select: {
        role: true,
        isMuted: true,
        leftAt: true,
        admissionConfirmedAt: true,
      },
    }),
};

/**
 * Application adapter for the dependency-free policy core shared with the
 * standalone security worker. LiveKit is checked before opening a transaction;
 * once configured, the core owns lock order, policy evaluation and the provider
 * effect-before-commit invariant.
 */
export const enforceParticipantPolicyLocked = async (
  roomId: string,
  userId: string,
): Promise<LivekitParticipantPolicyEffect> => {
  if (!livekitService.isConfigured()) return { kind: 'unconfigured' };
  return enforceLivekitParticipantPolicyLocked({
    store: participantPolicyStore,
    provider: livekitService,
    legalDocumentVersion: currentLegalDocumentVersion(),
    roomId,
    userId,
  });
};

/**
 * Provider removals are intentionally revalidated at delivery time. A user
 * may legitimately rejoin after a short kick expires while a previous
 * provider attempt is waiting to retry; that old transition must never evict
 * the newly-authorized session.
 */
export const deliverLivekitRevocation = async (event: OutboxEvent): Promise<void> => {
  const { roomId, userId } = payloadOf(event);
  const effect = await enforceParticipantPolicyLocked(roomId, userId);
  if (effect.kind === 'unconfigured') return;

  // Self-hosted LiveKit does not revoke an already-issued JWT, and token
  // expiry does not disconnect an existing session. Keep removing through the
  // whole maximum pre-revocation token lifetime, then perform one final remove
  // after that horizon before acknowledging delivery. Each retry starts with
  // the active-participant check above, so a legitimate application rejoin
  // makes the old transition a successful no-op instead of being evicted.
  await requireLivekitCredentialDrain(event);
};

registerOutboxHandler(LIVEKIT_REVOCATION_TOPIC, deliverLivekitRevocation);

export const wakeLivekitRevocation = (transitionId: string): Promise<number> =>
  wakeAndProcessOutbox(LIVEKIT_REVOCATION_TOPIC, transitionId);

/** Remove the only personal identifiers retained by this FK-free envelope. */
export const purgeLivekitRevocationsForUser = async (userId: string): Promise<number> => {
  const envelopes = await prisma.outboxEvent.findMany({
    where: {
      topic: LIVEKIT_REVOCATION_TOPIC,
      payload: { path: ['userId'], equals: userId },
    },
    select: { payload: true },
  });
  // Hard purge happens after the 30-day account grace period, far beyond the
  // token horizon. Perform one strict final provider removal before erasing
  // the retry envelopes; any provider outage aborts the account purge so the
  // next GDPR run can retry instead of deleting the only durable hand-off.
  if (livekitService.isConfigured()) {
    const roomIds = new Set(
      envelopes.flatMap(envelope => {
        const payload = envelope.payload as Record<string, unknown>;
        return typeof payload['roomId'] === 'string' ? [payload['roomId']] : [];
      }),
    );
    for (const roomId of roomIds) {
      await livekitService.removeParticipant(roomId, userId);
    }
  }
  const deleted = await prisma.outboxEvent.deleteMany({
    where: {
      topic: LIVEKIT_REVOCATION_TOPIC,
      payload: { path: ['userId'], equals: userId },
    },
  });
  return deleted.count;
};
