/* eslint-disable no-console */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { Prisma, PrismaClient, type OutboxEvent, type RecordingStatus } from '@prisma/client';
import {
  EgressStatus,
  RoomServiceClient,
  WebhookReceiver,
  type EgressInfo,
  type WebhookEvent,
} from 'livekit-server-sdk';
import { z } from 'zod';
import {
  enforceLivekitParticipantPolicyLocked,
  type LivekitParticipantPolicyProvider,
  type LivekitParticipantPolicyStore,
} from './livekitParticipantPolicy.core';

export const LIVEKIT_PARTICIPANT_REVOCATION_TOPIC = 'livekit.participant.revoke';
export const LIVEKIT_ROOM_REVOCATION_TOPIC = 'livekit.room.revoke';
export const LIVEKIT_SECURITY_TOPICS = [
  LIVEKIT_PARTICIPANT_REVOCATION_TOPIC,
  LIVEKIT_ROOM_REVOCATION_TOPIC,
] as const;

const CONTRACT_VERSION = 'v1';
const DEFAULT_BATCH_SIZE = 10;
const POLL_INTERVAL_MS = 500;
const OUTBOX_LEASE_MS = 30_000;
const LEASE_HEARTBEAT_MS = 10_000;
const HANDLER_TIMEOUT_MS = 20_000;
const PROVIDER_PROBE_INTERVAL_MS = 10_000;
export const LIVEKIT_PROVIDER_PROBE_STALE_MS = 35_000;
const LIVEKIT_PROVIDER_PROBE_ROOM = '__chathouse_security_worker_health__';
const PROVIDER_REFRESH_TTL_SECONDS = 10 * 60;
const WEBHOOK_BODY_LIMIT_BYTES = 512 * 1024;
const SHUTDOWN_GRACE_MS = 28_000;

const optionalUrl = z.preprocess(
  value => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string().trim().url().optional(),
);

const workerEnvSchema = z
  .object({
    DATABASE_URL: z.string().trim().url(),
    LIVEKIT_URL: z.string().trim().url(),
    LIVEKIT_INTERNAL_URL: optionalUrl,
    LIVEKIT_API_KEY: z
      .string()
      .trim()
      .min(8)
      .refine(value => !/\s/.test(value)),
    LIVEKIT_API_SECRET: z
      .string()
      .trim()
      .min(32)
      .refine(value => !/\s/.test(value)),
    LIVEKIT_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(300).default(300),
    LIVEKIT_REVOCATION_CONTRACT_VERSION: z.literal(CONTRACT_VERSION),
    LEGAL_DOCUMENT_VERSION: z
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}-\d{2}$/),
    LIVEKIT_SECURITY_WORKER_HOST: z.string().trim().min(1).default('0.0.0.0'),
    LIVEKIT_SECURITY_WORKER_PORT: z.coerce.number().int().min(1).max(65_535).default(4010),
    RECORDING_PUBLIC_BASE_URL: optionalUrl,
    LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
  })
  .superRefine((value, ctx) => {
    if (value.LIVEKIT_API_KEY === value.LIVEKIT_API_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['LIVEKIT_API_SECRET'],
        message: 'LiveKit API key and secret must be distinct',
      });
    }
    const internal = value.LIVEKIT_INTERNAL_URL ? new URL(value.LIVEKIT_INTERNAL_URL) : null;
    if (internal && !['http:', 'https:'].includes(internal.protocol)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['LIVEKIT_INTERNAL_URL'],
        message: 'LiveKit internal URL must use HTTP(S)',
      });
    }
  });

export type LivekitSecurityWorkerEnv = z.infer<typeof workerEnvSchema>;

export const parseLivekitSecurityWorkerEnv = (input: NodeJS.ProcessEnv): LivekitSecurityWorkerEnv =>
  workerEnvSchema.parse(input);

type LogLevel = LivekitSecurityWorkerEnv['LOG_LEVEL'];
const LOG_LEVEL_WEIGHT: Record<LogLevel, number> = { error: 0, warn: 1, info: 2, debug: 3 };

class SecurityLogger {
  constructor(private readonly threshold: LogLevel) {}

  private write(level: LogLevel, message: string, meta: Record<string, unknown> = {}): void {
    if (LOG_LEVEL_WEIGHT[level] > LOG_LEVEL_WEIGHT[this.threshold]) return;
    const record = JSON.stringify({ timestamp: new Date().toISOString(), level, message, ...meta });
    if (level === 'error') console.error(record);
    else if (level === 'warn') console.warn(record);
    else console.log(record);
  }

  error(message: string, meta?: Record<string, unknown>): void {
    this.write('error', message, meta);
  }

  warn(message: string, meta?: Record<string, unknown>): void {
    this.write('warn', message, meta);
  }

  info(message: string, meta?: Record<string, unknown>): void {
    this.write('info', message, meta);
  }

  debug(message: string, meta?: Record<string, unknown>): void {
    this.write('debug', message, meta);
  }
}

const failureCategory = (error: unknown): string => {
  if (!(error instanceof Error)) return 'NonErrorFailure';
  return (error.name || 'Error').slice(0, 100);
};

class HandlerDeadlineError extends Error {
  constructor() {
    super('LiveKit security handler deadline exceeded');
    this.name = 'LivekitSecurityHandlerDeadline';
  }
}

class CredentialDrainOpenError extends Error {
  constructor() {
    super('Pre-revocation LiveKit credentials have not all expired');
    this.name = 'LivekitRevocationWindowOpen';
  }
}

export class LivekitWebhookAuthenticationError extends Error {
  constructor(cause: unknown) {
    super('Invalid LiveKit webhook authentication', { cause });
    this.name = 'LivekitWebhookAuthenticationError';
  }
}

export class LivekitWebhookUnavailableError extends Error {
  constructor(message = 'LiveKit webhook processing is unavailable') {
    super(message);
    this.name = 'LivekitWebhookUnavailableError';
  }
}

interface RoomAdminClient {
  listRooms(names?: string[]): Promise<unknown>;
  removeParticipant(room: string, identity: string): Promise<void>;
  updateParticipant(
    room: string,
    identity: string,
    options: {
      permission: { canPublish: boolean; canSubscribe: boolean; canPublishData: boolean };
    },
  ): Promise<unknown>;
  deleteRoom(room: string): Promise<void>;
}

interface WebhookVerifier {
  receive(body: string, authHeader?: string): Promise<WebhookEvent>;
}

const providerHost = (env: LivekitSecurityWorkerEnv): string =>
  (env.LIVEKIT_INTERNAL_URL ?? env.LIVEKIT_URL).replace(/^ws/i, 'http');

export const isLivekitAlreadyAbsent = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { code?: unknown };
  const code = typeof candidate.code === 'string' ? candidate.code.toLowerCase() : candidate.code;
  // Only the structured Twirp not_found code proves the participant/room is
  // absent. A plain HTTP 404 or "not found" message may come from a bad
  // LiveKit URL/proxy route and must remain retryable.
  return code === 'not_found' || code === 'notfound' || code === 5;
};

const retryDelayMs = (attempts: number): number =>
  Math.min(60_000, 1_000 * 2 ** Math.min(Math.max(attempts - 1, 0), 6));

type ParticipantPayload = { roomId: string; userId: string };
type RoomPayload = { roomId: string };

const payloadRecord = (event: OutboxEvent): Record<string, unknown> => {
  if (!event.payload || typeof event.payload !== 'object' || Array.isArray(event.payload)) {
    throw new Error('Invalid LiveKit security outbox payload');
  }
  return event.payload as Record<string, unknown>;
};

const participantPayload = (event: OutboxEvent): ParticipantPayload => {
  const payload = payloadRecord(event);
  const roomId = payload['roomId'];
  const userId = payload['userId'];
  if (typeof roomId !== 'string' || roomId.length === 0) throw new Error('Missing roomId');
  if (typeof userId !== 'string' || userId.length === 0) throw new Error('Missing userId');
  return { roomId, userId };
};

const roomPayload = (event: OutboxEvent): RoomPayload => {
  const payload = payloadRecord(event);
  const roomId = payload['roomId'];
  if (typeof roomId !== 'string' || roomId.length === 0) throw new Error('Missing roomId');
  return { roomId };
};

export class LivekitSecurityRuntime {
  private readonly credentialDrainMs: number;

  constructor(
    readonly env: LivekitSecurityWorkerEnv,
    private readonly prisma: PrismaClient,
    private readonly provider: RoomAdminClient,
    private readonly webhookVerifier: WebhookVerifier,
    private readonly logger: SecurityLogger,
  ) {
    this.credentialDrainMs =
      (Math.max(env.LIVEKIT_TOKEN_TTL_SECONDS, PROVIDER_REFRESH_TTL_SECONDS) + 10) * 1_000;
  }

  async preflight(): Promise<void> {
    const rows = await this.prisma.$queryRaw<
      Array<{
        outbox_table: boolean;
        effect_column: boolean;
        participant_table: boolean;
        admission_column: boolean;
        recording_table: boolean;
      }>
    >(Prisma.sql`
      SELECT
        to_regclass('public."OutboxEvent"') IS NOT NULL AS outbox_table,
        EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'OutboxEvent'
            AND column_name = 'effectStartedAt'
        ) AS effect_column,
        to_regclass('public."Participant"') IS NOT NULL AS participant_table,
        EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'Participant'
            AND column_name = 'admissionConfirmedAt'
        ) AS admission_column,
        to_regclass('public."Recording"') IS NOT NULL AS recording_table
    `);
    const row = rows[0];
    if (
      !row?.outbox_table ||
      !row.effect_column ||
      !row.participant_table ||
      !row.admission_column ||
      !row.recording_table
    ) {
      throw new Error('LiveKit security worker database contract is incomplete');
    }
    await this.probeProvider();
  }

  async probeProvider(): Promise<void> {
    // A synthetic exact-name filter keeps the authenticated readiness request
    // bounded even on providers with many active rooms.
    await this.provider.listRooms([LIVEKIT_PROVIDER_PROBE_ROOM]);
  }

  private async removeParticipant(roomId: string, userId: string): Promise<void> {
    try {
      await this.provider.removeParticipant(roomId, userId);
    } catch (error) {
      if (!isLivekitAlreadyAbsent(error)) throw error;
    }
  }

  private async deleteRoom(roomId: string): Promise<void> {
    try {
      await this.provider.deleteRoom(roomId);
    } catch (error) {
      if (!isLivekitAlreadyAbsent(error)) throw error;
    }
  }

  private async setParticipantCanPublish(
    roomId: string,
    userId: string,
    canPublish: boolean,
  ): Promise<void> {
    try {
      await this.provider.updateParticipant(roomId, userId, {
        permission: { canPublish, canSubscribe: true, canPublishData: false },
      });
    } catch (error) {
      if (!isLivekitAlreadyAbsent(error)) throw error;
    }
  }

  async enforceParticipantPolicyLocked(
    roomId: string,
    userId: string,
  ): Promise<'remove' | 'permissions'> {
    type Transaction = Prisma.TransactionClient;
    const store: LivekitParticipantPolicyStore<Transaction> = {
      transaction: (work, options) =>
        this.prisma.$transaction(transaction => work(transaction), options),
      setLocalLockTimeout: async transaction => {
        await transaction.$executeRawUnsafe("SET LOCAL lock_timeout = '1000ms'");
      },
      lockRoom: async (transaction, id) => {
        await transaction.$queryRaw`SELECT "id" FROM "Room" WHERE "id" = ${id} FOR UPDATE`;
      },
      lockUser: async (transaction, id) => {
        await transaction.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${id} FOR UPDATE`;
      },
      lockParticipant: async (transaction, lockedRoomId, lockedUserId) => {
        await transaction.$queryRaw`SELECT "id" FROM "Participant" WHERE "roomId" = ${lockedRoomId} AND "userId" = ${lockedUserId} FOR UPDATE`;
      },
      readRoom: (transaction, id) =>
        transaction.room.findUnique({
          where: { id },
          select: { hostId: true, isLive: true, endedAt: true },
        }),
      readUser: (transaction, id) =>
        transaction.user.findUnique({
          where: { id },
          select: {
            deletedAt: true,
            suspendedUntil: true,
            termsAcceptedVersion: true,
            termsAcceptedAt: true,
            privacyNoticeAcknowledgedVersion: true,
            privacyNoticeAcknowledgedAt: true,
            legalAcceptanceLocale: true,
          },
        }),
      readParticipant: (transaction, lockedRoomId, lockedUserId) =>
        transaction.participant.findUnique({
          where: { userId_roomId: { roomId: lockedRoomId, userId: lockedUserId } },
          select: { role: true, isMuted: true, leftAt: true, admissionConfirmedAt: true },
        }),
    };
    const provider: LivekitParticipantPolicyProvider = {
      removeParticipant: (lockedRoomId, lockedUserId) =>
        this.removeParticipant(lockedRoomId, lockedUserId),
      setParticipantCanPublish: (lockedRoomId, lockedUserId, canPublish) =>
        this.setParticipantCanPublish(lockedRoomId, lockedUserId, canPublish),
    };
    const effect = await enforceLivekitParticipantPolicyLocked({
      store,
      provider,
      legalDocumentVersion: this.env.LEGAL_DOCUMENT_VERSION,
      roomId,
      userId,
    });
    return effect.kind;
  }

  private async requireCredentialDrain(event: OutboxEvent): Promise<void> {
    const now = new Date();
    if (!event.effectStartedAt) {
      await this.prisma.outboxEvent.updateMany({
        where: { id: event.id, deliveredAt: null, effectStartedAt: null },
        data: { effectStartedAt: now },
      });
      throw new CredentialDrainOpenError();
    }
    if (now.getTime() < event.effectStartedAt.getTime() + this.credentialDrainMs) {
      throw new CredentialDrainOpenError();
    }
  }

  private async deliverParticipantRevocation(event: OutboxEvent): Promise<void> {
    const { roomId, userId } = participantPayload(event);
    await this.enforceParticipantPolicyLocked(roomId, userId);
    await this.requireCredentialDrain(event);
  }

  private async deliverRoomRevocation(event: OutboxEvent): Promise<void> {
    const { roomId } = roomPayload(event);
    const room = await this.prisma.room.findUnique({
      where: { id: roomId },
      select: { isLive: true, endedAt: true },
    });
    if (room?.isLive && !room.endedAt) return;
    await this.deleteRoom(roomId);
    await this.requireCredentialDrain(event);
  }

  private async runHandler(event: OutboxEvent): Promise<void> {
    if (event.topic === LIVEKIT_PARTICIPANT_REVOCATION_TOPIC) {
      await this.deliverParticipantRevocation(event);
      return;
    }
    if (event.topic === LIVEKIT_ROOM_REVOCATION_TOPIC) {
      await this.deliverRoomRevocation(event);
      return;
    }
    throw new Error('Unsupported LiveKit security topic');
  }

  private async claimBatch(
    topic: (typeof LIVEKIT_SECURITY_TOPICS)[number],
  ): Promise<OutboxEvent[]> {
    const claimedAt = new Date();
    const staleBefore = new Date(claimedAt.getTime() - OUTBOX_LEASE_MS);
    return this.prisma.$transaction(tx =>
      tx.$queryRaw<OutboxEvent[]>(Prisma.sql`
        WITH candidates AS (
          SELECT id
          FROM "OutboxEvent"
          WHERE "deliveredAt" IS NULL
            AND "availableAt" <= ${claimedAt}
            AND "topic" = ${topic}
            AND (
              "status" = 'PENDING'
              OR (
                "status" = 'PROCESSING'
                AND ("claimedAt" IS NULL OR "claimedAt" <= ${staleBefore})
              )
            )
          ORDER BY "availableAt" ASC, id ASC
          FOR UPDATE SKIP LOCKED
          LIMIT ${DEFAULT_BATCH_SIZE}
        )
        UPDATE "OutboxEvent" AS event
        SET "status" = 'PROCESSING',
            "attempts" = event."attempts" + 1,
            "claimedAt" = ${claimedAt},
            "updatedAt" = ${claimedAt}
        FROM candidates
        WHERE event.id = candidates.id
        RETURNING event.*
      `),
    );
  }

  private async runHandlerWithDeadline(event: OutboxEvent): Promise<void> {
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        this.runHandler(event),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new HandlerDeadlineError()), HANDLER_TIMEOUT_MS);
          timer.unref();
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private async processOne(event: OutboxEvent): Promise<void> {
    let currentClaimedAt = event.claimedAt;
    let leaseLost = false;
    let heartbeatInFlight: Promise<void> = Promise.resolve();
    const renewLease = async (): Promise<void> => {
      if (!currentClaimedAt || leaseLost) return;
      const nextClaimedAt = new Date();
      const renewed = await this.prisma.outboxEvent.updateMany({
        where: {
          id: event.id,
          status: 'PROCESSING',
          deliveredAt: null,
          claimedAt: currentClaimedAt,
        },
        data: { claimedAt: nextClaimedAt },
      });
      if (renewed.count === 1) currentClaimedAt = nextClaimedAt;
      else leaseLost = true;
    };
    const heartbeat = setInterval(() => {
      heartbeatInFlight = heartbeatInFlight.then(renewLease).catch(error => {
        this.logger.warn('LiveKit outbox lease heartbeat failed', {
          topic: event.topic,
          category: failureCategory(error),
        });
      });
    }, LEASE_HEARTBEAT_MS);
    heartbeat.unref();

    try {
      await this.runHandlerWithDeadline(event);
      clearInterval(heartbeat);
      await heartbeatInFlight;
      if (leaseLost || !currentClaimedAt) return;
      await this.prisma.outboxEvent.updateMany({
        where: {
          id: event.id,
          status: 'PROCESSING',
          deliveredAt: null,
          claimedAt: currentClaimedAt,
        },
        data: {
          status: 'DELIVERED',
          deliveredAt: new Date(),
          claimedAt: null,
          lastError: null,
        },
      });
    } catch (error) {
      clearInterval(heartbeat);
      await heartbeatInFlight;
      if (leaseLost || !currentClaimedAt) return;
      await this.prisma.outboxEvent.updateMany({
        where: {
          id: event.id,
          status: 'PROCESSING',
          deliveredAt: null,
          claimedAt: currentClaimedAt,
        },
        data: {
          status: 'PENDING',
          availableAt: new Date(Date.now() + retryDelayMs(event.attempts)),
          claimedAt: null,
          lastError: failureCategory(error),
        },
      });
      this.logger.warn('LiveKit security delivery failed; retry scheduled', {
        topic: event.topic,
        category: failureCategory(error),
      });
    }
  }

  async processAllBatches(): Promise<number> {
    const batches = await Promise.all(
      LIVEKIT_SECURITY_TOPICS.map(async topic => {
        const events = await this.claimBatch(topic);
        await Promise.all(events.map(event => this.processOne(event)));
        return events.length;
      }),
    );
    return batches.reduce((total, count) => total + count, 0);
  }

  private mapRecordingStatus(status: EgressStatus): RecordingStatus {
    switch (status) {
      case EgressStatus.EGRESS_STARTING:
        return 'STARTING';
      case EgressStatus.EGRESS_ACTIVE:
      case EgressStatus.EGRESS_ENDING:
        return 'ACTIVE';
      case EgressStatus.EGRESS_COMPLETE:
        return 'COMPLETED';
      case EgressStatus.EGRESS_ABORTED:
        return 'ABORTED';
      default:
        return 'FAILED';
    }
  }

  private playbackUrl(file: { filename: string; location: string }): string {
    const base = this.env.RECORDING_PUBLIC_BASE_URL?.replace(/\/+$/, '');
    if (base && file.filename) return `${base}/${file.filename.replace(/^\/+/, '')}`;
    return file.location;
  }

  private async applyEgressInfo(info: EgressInfo): Promise<void> {
    const data: Prisma.RecordingUpdateManyMutationInput = {
      status: this.mapRecordingStatus(info.status),
    };
    if (info.endedAt > 0n) data.endedAt = new Date(Number(info.endedAt / 1_000_000n));
    const file = info.fileResults[0];
    if (file) {
      if (file.location || file.filename) data.fileUrl = this.playbackUrl(file);
      if (file.duration > 0n) data.durationMs = Number(file.duration / 1_000_000n);
    }
    await this.prisma.recording.updateMany({
      where: { egressId: info.egressId, status: { in: ['STARTING', 'ACTIVE'] } },
      data,
    });
  }

  async handleWebhook(body: string, authHeader: string | undefined): Promise<void> {
    let event: WebhookEvent;
    try {
      event = await this.webhookVerifier.receive(body, authHeader);
    } catch (cause) {
      throw new LivekitWebhookAuthenticationError(cause);
    }

    if (event.event === 'participant_joined' || event.event === 'track_published') {
      const roomId = event.room?.name.trim() ?? '';
      const userId = event.participant?.identity.trim() ?? '';
      if (!roomId || !userId) {
        throw new LivekitWebhookUnavailableError('LiveKit participant webhook is incomplete');
      }
      await this.enforceParticipantPolicyLocked(roomId, userId);
    }
    if (event.egressInfo) await this.applyEgressInfo(event.egressInfo);
  }

  async disconnect(): Promise<void> {
    await this.prisma.$disconnect();
  }
}

export interface LivekitSecurityHealthState {
  ready: boolean;
  lastSuccessfulPollAt: number;
  lastSuccessfulProviderProbeAt: number;
}

export const isLivekitSecurityHealthReady = (
  health: LivekitSecurityHealthState,
  now = Date.now(),
): boolean =>
  health.ready &&
  now - health.lastSuccessfulPollAt <= HANDLER_TIMEOUT_MS * 2 + 5_000 &&
  now - health.lastSuccessfulProviderProbeAt <= LIVEKIT_PROVIDER_PROBE_STALE_MS;

export const refreshLivekitProviderHealth = async (
  runtime: Pick<LivekitSecurityRuntime, 'probeProvider'>,
  health: LivekitSecurityHealthState,
  logger: Pick<SecurityLogger, 'error'>,
  now: () => number = Date.now,
): Promise<boolean> => {
  try {
    await runtime.probeProvider();
    health.lastSuccessfulProviderProbeAt = now();
    return true;
  } catch (error) {
    logger.error('LiveKit provider readiness probe failed', {
      category: failureCategory(error),
    });
    return false;
  }
};

const sendJson = (response: ServerResponse, status: number, body: object): void => {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
};

class PayloadTooLargeError extends Error {}

const readRawBody = (request: IncomingMessage): Promise<string> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    request.on('data', (chunk: Buffer | string) => {
      if (settled) return;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > WEBHOOK_BODY_LIMIT_BYTES) {
        settled = true;
        request.resume();
        reject(new PayloadTooLargeError());
        return;
      }
      chunks.push(buffer);
    });
    request.on('end', () => {
      if (!settled) resolve(Buffer.concat(chunks).toString('utf8'));
    });
    request.on('error', error => {
      if (!settled) reject(error);
    });
  });

export const createLivekitSecurityHttpServer = (
  runtime: Pick<LivekitSecurityRuntime, 'handleWebhook'>,
  health: LivekitSecurityHealthState,
  logger: Pick<SecurityLogger, 'warn' | 'error'>,
): Server => {
  const server = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? '/', 'http://livekit-security.local');
      if (request.method === 'GET' && url.pathname === '/health/live') {
        const ready = isLivekitSecurityHealthReady(health);
        sendJson(response, ready ? 200 : 503, {
          ok: ready,
          contract: CONTRACT_VERSION,
        });
        return;
      }
      if (request.method !== 'POST' || url.pathname !== '/webhooks/livekit') {
        sendJson(response, 404, { ok: false });
        return;
      }

      try {
        const body = await readRawBody(request);
        const authorization = request.headers.authorization;
        await runtime.handleWebhook(body, authorization);
        sendJson(response, 200, { ok: true });
      } catch (error) {
        if (error instanceof PayloadTooLargeError) {
          sendJson(response, 413, { ok: false });
          return;
        }
        if (error instanceof LivekitWebhookAuthenticationError) {
          logger.warn('LiveKit webhook authentication rejected', {
            category: failureCategory(error),
          });
          sendJson(response, 401, { ok: false });
          return;
        }
        logger.error('LiveKit webhook processing failed', { category: failureCategory(error) });
        response.setHeader('Retry-After', '1');
        sendJson(response, 503, { ok: false });
      }
    })();
  });
  server.requestTimeout = 25_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5_000;
  server.maxRequestsPerSocket = 100;
  return server;
};

const listen = (server: Server, host: string, port: number): Promise<void> =>
  new Promise((resolve, reject) => {
    const onError = (error: Error): void => reject(error);
    server.once('error', onError);
    server.listen(port, host, () => {
      server.off('error', onError);
      resolve();
    });
  });

const closeServer = (server: Server): Promise<void> =>
  new Promise((resolve, reject) => {
    server.close(error => {
      if (error) reject(error);
      else resolve();
    });
  });

const waitForPoll = (signal: AbortSignal): Promise<void> =>
  new Promise(resolve => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(done, POLL_INTERVAL_MS);
    function done(): void {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    }
    signal.addEventListener('abort', done, { once: true });
  });

export const buildLivekitSecurityRuntime = (
  env: LivekitSecurityWorkerEnv,
): { runtime: LivekitSecurityRuntime; logger: SecurityLogger } => {
  const logger = new SecurityLogger(env.LOG_LEVEL);
  const prisma = new PrismaClient({
    datasources: { db: { url: env.DATABASE_URL } },
    log: ['error', 'warn'],
  });
  const provider = new RoomServiceClient(
    providerHost(env),
    env.LIVEKIT_API_KEY,
    env.LIVEKIT_API_SECRET,
    { requestTimeout: 15 },
  );
  const verifier = new WebhookReceiver(env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET);
  return { runtime: new LivekitSecurityRuntime(env, prisma, provider, verifier, logger), logger };
};

export const runLivekitSecurityWorker = async (
  env: LivekitSecurityWorkerEnv,
  signal: AbortSignal,
): Promise<void> => {
  const { runtime, logger } = buildLivekitSecurityRuntime(env);
  const health: LivekitSecurityHealthState = {
    ready: false,
    lastSuccessfulPollAt: 0,
    lastSuccessfulProviderProbeAt: 0,
  };
  let server: Server | null = null;
  try {
    await runtime.preflight();
    health.lastSuccessfulProviderProbeAt = Date.now();
    let lastProviderProbeAttemptAt = health.lastSuccessfulProviderProbeAt;
    await runtime.processAllBatches();
    health.lastSuccessfulPollAt = Date.now();
    server = createLivekitSecurityHttpServer(runtime, health, logger);
    await listen(server, env.LIVEKIT_SECURITY_WORKER_HOST, env.LIVEKIT_SECURITY_WORKER_PORT);
    health.ready = true;
    logger.info('LiveKit security worker ready', {
      contract: CONTRACT_VERSION,
      port: env.LIVEKIT_SECURITY_WORKER_PORT,
      topics: LIVEKIT_SECURITY_TOPICS,
    });

    while (!signal.aborted) {
      await waitForPoll(signal);
      if (signal.aborted) break;
      const processed = await runtime.processAllBatches();
      health.lastSuccessfulPollAt = Date.now();
      if (processed > 0) logger.debug('LiveKit security batch processed', { count: processed });
      if (Date.now() - lastProviderProbeAttemptAt >= PROVIDER_PROBE_INTERVAL_MS) {
        lastProviderProbeAttemptAt = Date.now();
        await refreshLivekitProviderHealth(runtime, health, logger);
      }
    }
  } finally {
    health.ready = false;
    if (server) await closeServer(server);
    await runtime.disconnect();
  }
};

export const checkLivekitSecurityWorker = async (env: LivekitSecurityWorkerEnv): Promise<void> => {
  const { runtime, logger } = buildLivekitSecurityRuntime(env);
  try {
    await runtime.preflight();
    logger.info('LiveKit security worker preflight passed', { contract: CONTRACT_VERSION });
  } finally {
    await runtime.disconnect();
  }
};

const main = async (): Promise<void> => {
  const env = parseLivekitSecurityWorkerEnv(process.env);
  if (process.argv.includes('--check')) {
    await checkLivekitSecurityWorker(env);
    return;
  }

  const abortController = new AbortController();
  let shutdownTimer: NodeJS.Timeout | null = null;
  const stop = (signal: NodeJS.Signals): void => {
    if (abortController.signal.aborted) return;
    console.log(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'info',
        message: 'LiveKit security worker shutdown requested',
        signal,
      }),
    );
    abortController.abort();
    shutdownTimer = setTimeout(() => process.exit(1), SHUTDOWN_GRACE_MS);
    shutdownTimer.unref();
  };
  process.once('SIGTERM', () => stop('SIGTERM'));
  process.once('SIGINT', () => stop('SIGINT'));
  process.once('SIGHUP', () => stop('SIGHUP'));
  await runLivekitSecurityWorker(env, abortController.signal);
  if (shutdownTimer) clearTimeout(shutdownTimer);
};

if (require.main === module) {
  void main().catch(error => {
    console.error(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'error',
        message: 'LiveKit security worker failed',
        category: failureCategory(error),
      }),
    );
    process.exitCode = 1;
  });
}
