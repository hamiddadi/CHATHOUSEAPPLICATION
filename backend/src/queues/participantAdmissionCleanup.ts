import { performance } from 'node:perf_hooks';
import type { Server } from 'socket.io';
import { prisma } from '../config/database';
import { logger } from '../config/logger';
import { roomsService, type ParticipantAdmissionIdentity } from '../modules/rooms/rooms.service';
import { roomChannel } from '../socket/channels';

export const PARTICIPANT_ADMISSION_GRACE_MS = 2 * 60_000;
export const PARTICIPANT_ADMISSION_SWEEP_INTERVAL_MS = 30_000;
const PARTICIPANT_ADMISSION_BATCH_SIZE = 100;
const PARTICIPANT_ADMISSION_CLASS_QUOTA = PARTICIPANT_ADMISSION_BATCH_SIZE / 2;
const PARTICIPANT_HEARTBEAT_BATCH_SIZE = 500;

const pairKey = (roomId: string, userId: string): string => `${roomId}\u0000${userId}`;

export interface ParticipantAdmissionSweepResult {
  scanned: number;
  present: number;
  heartbeated: number;
  expired: number;
}

/**
 * Reconcile durable Participant presence against one complete cluster-wide
 * Socket.IO adapter snapshot. The snapshot is obtained before any mutation;
 * an adapter error aborts the whole cycle and is never interpreted as an
 * empty room. Exact timestamps make every heartbeat/expiry race fail closed.
 */
export const reconcileParticipantAdmissions = async (
  io: Server,
  now = new Date(),
  monotonicNow: () => number = () => performance.now(),
): Promise<ParticipantAdmissionSweepResult> => {
  const cycleStartedAt = monotonicNow();
  const staleBefore = new Date(now.getTime() - PARTICIPANT_ADMISSION_GRACE_MS);
  const candidateSelect = {
    id: true,
    roomId: true,
    userId: true,
    joinedAt: true,
    admissionConfirmedAt: true,
  } as const;
  // Independent budgets guarantee progress for both abandoned pre-socket
  // admissions and confirmed leases under a sustained load in either class.
  const unconfirmedCandidates = await prisma.participant.findMany({
    where: {
      leftAt: null,
      admissionConfirmedAt: null,
      joinedAt: { lte: staleBefore },
    },
    select: candidateSelect,
    orderBy: [{ joinedAt: 'asc' }, { id: 'asc' }],
    take: PARTICIPANT_ADMISSION_BATCH_SIZE,
  });
  const confirmedCandidates = await prisma.participant.findMany({
    where: {
      leftAt: null,
      admissionConfirmedAt: { not: null, lte: staleBefore },
    },
    select: candidateSelect,
    orderBy: [{ admissionConfirmedAt: 'asc' }, { joinedAt: 'asc' }, { id: 'asc' }],
    take: PARTICIPANT_ADMISSION_BATCH_SIZE,
  });
  const selected = [
    ...unconfirmedCandidates.slice(0, PARTICIPANT_ADMISSION_CLASS_QUOTA),
    ...confirmedCandidates.slice(0, PARTICIPANT_ADMISSION_CLASS_QUOTA),
  ];
  let remaining = PARTICIPANT_ADMISSION_BATCH_SIZE - selected.length;
  if (remaining > 0) {
    const extraUnconfirmed = unconfirmedCandidates.slice(
      PARTICIPANT_ADMISSION_CLASS_QUOTA,
      PARTICIPANT_ADMISSION_CLASS_QUOTA + remaining,
    );
    selected.push(...extraUnconfirmed);
    remaining -= extraUnconfirmed.length;
  }
  if (remaining > 0) {
    selected.push(
      ...confirmedCandidates.slice(
        PARTICIPANT_ADMISSION_CLASS_QUOTA,
        PARTICIPANT_ADMISSION_CLASS_QUOTA + remaining,
      ),
    );
  }
  const candidates = [...new Map(selected.map(candidate => [candidate.id, candidate])).values()];
  if (candidates.length === 0) {
    return { scanned: 0, present: 0, heartbeated: 0, expired: 0 };
  }

  const candidateChannels = new Set(candidates.map(candidate => roomChannel(candidate.roomId)));
  // Redis adapter fetchSockets is all-or-error for this union. Do not catch
  // here: callers log/retry, while this cycle performs zero writes.
  const peers = await io.in([...candidateChannels]).fetchSockets();
  const presentPairs = new Map<string, { roomId: string; userId: string }>();
  for (const peer of peers) {
    const userId = (peer.data as { userId?: unknown }).userId;
    if (typeof userId !== 'string') continue;
    for (const channel of peer.rooms) {
      if (!candidateChannels.has(channel) || !channel.startsWith('room:')) continue;
      const roomId = channel.slice('room:'.length);
      presentPairs.set(pairKey(roomId, userId), { roomId, userId });
    }
  }

  const present = candidates.filter(
    candidate =>
      candidate.admissionConfirmedAt !== null &&
      presentPairs.has(pairKey(candidate.roomId, candidate.userId)),
  );
  const absent = candidates
    .filter(
      candidate =>
        candidate.admissionConfirmedAt === null ||
        !presentPairs.has(pairKey(candidate.roomId, candidate.userId)),
    )
    .sort(
      (left, right) =>
        left.roomId.localeCompare(right.roomId) || left.userId.localeCompare(right.userId),
    );

  // Query only the socket identities actually observed in the candidate
  // rooms, in bounded chunks. This covers a listener promoted concurrently
  // to SPEAKER while avoiding an unbounded load of absent room history.
  const observedPresent: Array<{
    id: string;
    roomId: string;
    userId: string;
    joinedAt: Date;
    admissionConfirmedAt: Date;
  }> = [];
  const observedIdentities = [...presentPairs.values()];
  for (
    let offset = 0;
    offset < observedIdentities.length;
    offset += PARTICIPANT_HEARTBEAT_BATCH_SIZE
  ) {
    const identityBatch = observedIdentities.slice(
      offset,
      offset + PARTICIPANT_HEARTBEAT_BATCH_SIZE,
    );
    const rows = await prisma.participant.findMany({
      where: {
        leftAt: null,
        admissionConfirmedAt: { not: null, lte: now },
        OR: identityBatch.map(identity => ({
          roomId: identity.roomId,
          userId: identity.userId,
        })),
      },
      select: {
        id: true,
        roomId: true,
        userId: true,
        joinedAt: true,
        admissionConfirmedAt: true,
      },
      orderBy: { id: 'asc' },
      take: identityBatch.length,
    });
    observedPresent.push(
      ...rows.filter(
        (row): row is typeof row & { admissionConfirmedAt: Date } =>
          row.admissionConfirmedAt !== null,
      ),
    );
  }

  // Heartbeat every observed peer before expiring anyone. Exact lease CAS
  // clauses mean a leave/rejoin/confirmation race wins without being
  // overwritten, and a null lease can never be promoted from socket presence.
  let heartbeated = 0;
  for (
    let offset = 0;
    offset < observedPresent.length;
    offset += PARTICIPANT_HEARTBEAT_BATCH_SIZE
  ) {
    const batch = observedPresent.slice(offset, offset + PARTICIPANT_HEARTBEAT_BATCH_SIZE);
    const updated = await prisma.participant.updateMany({
      where: {
        leftAt: null,
        OR: batch.map(participant => ({
          id: participant.id,
          joinedAt: participant.joinedAt,
          admissionConfirmedAt: participant.admissionConfirmedAt,
        })),
      },
      data: { admissionConfirmedAt: now },
    });
    heartbeated += updated.count;
    // A lower count means concurrent transitions won. Those peers are
    // deliberately never reclassified as absent within the same snapshot.
  }

  let expired = 0;
  const snapshotStillValid = (): boolean =>
    monotonicNow() - cycleStartedAt < PARTICIPANT_ADMISSION_GRACE_MS;
  for (let index = 0; index < absent.length; index += 1) {
    // Never apply an arbitrarily old socket snapshot. A new cycle will take a
    // fresh cluster view before attempting the deferred rows.
    if (!snapshotStillValid()) {
      logger.warn('participant admission reconciliation snapshot expired', {
        deferred: absent.length - index,
      });
      break;
    }
    const candidate = absent[index] as (typeof absent)[number];
    const admission: ParticipantAdmissionIdentity = {
      participantId: candidate.id,
      joinedAt: candidate.joinedAt,
      admissionConfirmedAt: candidate.admissionConfirmedAt,
    };
    const result = await roomsService.expireStaleAdmission(
      candidate.roomId,
      candidate.userId,
      admission,
      staleBefore,
      snapshotStillValid,
    );
    if (result.changed) expired += 1;
  }

  return {
    scanned: candidates.length,
    present: present.length,
    heartbeated,
    expired,
  };
};

let running = false;
let timer: NodeJS.Timeout | null = null;
let activeSweep: Promise<void> | null = null;

const schedule = (io: Server, delayMs: number): void => {
  if (!running) return;
  timer = setTimeout(() => {
    timer = null;
    activeSweep = reconcileParticipantAdmissions(io)
      .then(result => {
        if (result.scanned > 0)
          logger.info('participant admission reconciliation completed', result);
      })
      .catch(err => {
        logger.error('participant admission reconciliation failed', { err });
      })
      .finally(() => {
        activeSweep = null;
        schedule(io, PARTICIPANT_ADMISSION_SWEEP_INTERVAL_MS);
      });
  }, delayMs);
  timer.unref();
};

export const startParticipantAdmissionCleanup = (io: Server): void => {
  if (running) return;
  running = true;
  // Give clients a full reconnect grace period after an API/node restart.
  schedule(io, PARTICIPANT_ADMISSION_GRACE_MS);
};

export const shutdownParticipantAdmissionCleanup = async (): Promise<void> => {
  running = false;
  if (timer) clearTimeout(timer);
  timer = null;
  await activeSweep;
  activeSweep = null;
};
