import {
  EgressClient,
  EgressStatus,
  EncodedFileOutput,
  EncodedFileType,
  S3Upload,
  WebhookReceiver,
} from 'livekit-server-sdk';
import type { EgressInfo } from 'livekit-server-sdk';
import type { Prisma, RecordingStatus } from '@prisma/client';
import { prisma } from '../../config/database';
import { env } from '../../config/env';
import { logger } from '../../config/logger';

/**
 * Room Replays via LiveKit Egress → an S3-compatible bucket.
 *
 * Feature-flagged exactly like the Stripe integration: recording is only
 * "configured" when EGRESS_ENABLED is on AND LiveKit + an S3 bucket/keys are
 * set. When unconfigured every entry point is a no-op, so rooms behave exactly
 * as before and no Recording rows are ever created. LiveKit Egress uploads the
 * file to S3 itself — the backend never streams media — so there's no AWS SDK
 * dependency; we just record the egress lifecycle and the public playback URL.
 */

const publicUser = {
  id: true,
  username: true,
  displayName: true,
  avatarUrl: true,
} as const;

const ACTIVE_STATUSES: RecordingStatus[] = ['STARTING', 'ACTIVE'];

const isConfigured = (): boolean =>
  Boolean(
    env.EGRESS_ENABLED &&
    env.LIVEKIT_URL &&
    env.LIVEKIT_API_KEY &&
    env.LIVEKIT_API_SECRET &&
    env.RECORDING_S3_BUCKET &&
    env.RECORDING_S3_ACCESS_KEY &&
    env.RECORDING_S3_SECRET &&
    // RECO-05: without a public base URL the only `fileUrl` we can surface is
    // the raw `s3://` location, which isn't browser-playable. Require it so we
    // never start a recording whose replay we can't actually serve.
    env.RECORDING_PUBLIC_BASE_URL,
  );

// WebhookReceiver only needs the LiveKit API key/secret (not S3), so it's
// available whenever LiveKit itself is configured.
const hasLivekitKeys = (): boolean => Boolean(env.LIVEKIT_API_KEY && env.LIVEKIT_API_SECRET);

// EgressClient wants the HTTP(S) host; LIVEKIT_URL is the ws(s):// endpoint.
const httpHost = (wsUrl: string): string => wsUrl.replace(/^ws/i, 'http');

let egressClientRef: EgressClient | null = null;
const egress = (): EgressClient => {
  if (!egressClientRef) {
    egressClientRef = new EgressClient(
      httpHost(env.LIVEKIT_URL as string),
      env.LIVEKIT_API_KEY as string,
      env.LIVEKIT_API_SECRET as string,
    );
  }
  return egressClientRef;
};

let webhookRef: WebhookReceiver | null = null;
const webhook = (): WebhookReceiver => {
  if (!webhookRef) {
    webhookRef = new WebhookReceiver(
      env.LIVEKIT_API_KEY as string,
      env.LIVEKIT_API_SECRET as string,
    );
  }
  return webhookRef;
};

const mapStatus = (status: EgressStatus): RecordingStatus => {
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
};

// LiveKit timestamps/durations are int64 nanoseconds.
const nsToMs = (ns: bigint): number => Number(ns / 1_000_000n);

// Build a browser-playable URL. Prefer RECORDING_PUBLIC_BASE_URL + object key
// (the raw s3:// location isn't playable); fall back to the reported location.
const playbackUrl = (file: { filename: string; location: string }): string => {
  const base = env.RECORDING_PUBLIC_BASE_URL?.replace(/\/+$/, '');
  if (base && file.filename) {
    return `${base}/${file.filename.replace(/^\/+/, '')}`;
  }
  return file.location;
};

// Persist the current egress state onto its Recording row (idempotent; keyed on
// the unique egressId so it updates 0 or 1 rows and never throws on a miss).
const applyEgressInfo = async (info: EgressInfo): Promise<void> => {
  const data: Prisma.RecordingUpdateManyMutationInput = { status: mapStatus(info.status) };
  if (info.endedAt > 0n) data.endedAt = new Date(nsToMs(info.endedAt));
  const file = info.fileResults[0];
  if (file) {
    if (file.location || file.filename) data.fileUrl = playbackUrl(file);
    if (file.duration > 0n) data.durationMs = nsToMs(file.duration);
  }
  // RECO-04: only write while the row is still non-terminal. A replayed webhook
  // (or a late reconcile) must never move a COMPLETED/FAILED/ABORTED recording
  // back to an earlier state.
  await prisma.recording.updateMany({
    where: { egressId: info.egressId, status: { in: ACTIVE_STATUSES } },
    data,
  });
};

// Webhook-less safety net: pull live egresses' current state from LiveKit so a
// replay finalizes even if the egress webhook isn't wired up.
const reconcileRoom = async (roomId: string): Promise<void> => {
  if (!isConfigured()) return;
  const pending = await prisma.recording.findMany({
    where: { roomId, status: { in: ACTIVE_STATUSES } },
    select: { egressId: true },
  });
  for (const row of pending) {
    try {
      const [info] = await egress().listEgress({ egressId: row.egressId });
      if (info) await applyEgressInfo(info);
    } catch (err) {
      logger.warn('recording reconcile failed', { roomId, egressId: row.egressId, err });
    }
  }
};

interface RecordingRow {
  id: string;
  roomId: string;
  status: RecordingStatus;
  fileUrl: string | null;
  durationMs: number | null;
  startedAt: Date;
  endedAt: Date | null;
  createdAt: Date;
}

const serialize = (r: RecordingRow) => ({
  id: r.id,
  roomId: r.roomId,
  status: r.status,
  fileUrl: r.fileUrl,
  durationMs: r.durationMs,
  startedAt: r.startedAt,
  endedAt: r.endedAt,
  createdAt: r.createdAt,
});

export const recordingsService = {
  isConfigured,

  /**
   * Start an audio-only room-composite egress for a room. No-op (returns null)
   * when egress isn't configured or a recording is already live for the room.
   * Best-effort: callers swallow errors so a failed start never blocks the room.
   */
  async startForRoom(roomId: string): Promise<{ egressId: string } | null> {
    if (!isConfigured()) return null;
    const live = await prisma.recording.findFirst({
      where: { roomId, status: { in: ACTIVE_STATUSES } },
      select: { id: true },
    });
    if (live) return null;

    const output = new EncodedFileOutput({
      fileType: EncodedFileType.OGG,
      // Group objects per room, unique per session via the {time} template.
      filepath: `recordings/${roomId}/{time}`,
      output: {
        case: 's3',
        value: new S3Upload({
          accessKey: env.RECORDING_S3_ACCESS_KEY as string,
          secret: env.RECORDING_S3_SECRET as string,
          bucket: env.RECORDING_S3_BUCKET as string,
          region: env.RECORDING_S3_REGION ?? '',
          endpoint: env.RECORDING_S3_ENDPOINT ?? '',
        }),
      },
    });

    const info = await egress().startRoomCompositeEgress(roomId, output, { audioOnly: true });
    const recording = await prisma.recording.create({
      data: {
        roomId,
        egressId: info.egressId,
        status: mapStatus(info.status),
        startedAt: info.startedAt > 0n ? new Date(nsToMs(info.startedAt)) : new Date(),
      },
    });
    logger.info('recording started', {
      roomId,
      egressId: info.egressId,
      recordingId: recording.id,
    });
    return { egressId: info.egressId };
  },

  /**
   * Stop every live egress for a room (called when the room ends). The webhook
   * (or a later reconcile) finalizes each row with its file URL + duration.
   */
  async stopForRoom(roomId: string): Promise<void> {
    if (!isConfigured()) return;
    const live = await prisma.recording.findMany({
      where: { roomId, status: { in: ACTIVE_STATUSES } },
      select: { egressId: true },
    });
    for (const row of live) {
      try {
        const info = await egress().stopEgress(row.egressId);
        await applyEgressInfo(info);
      } catch (err) {
        logger.warn('recording stop failed', { roomId, egressId: row.egressId, err });
      }
    }
  },

  /**
   * Verify + parse a LiveKit egress webhook and persist the egress state.
   * Throws on signature failure so the route can answer 401.
   */
  async handleWebhook(body: string, authHeader: string | undefined): Promise<void> {
    if (!hasLivekitKeys()) return;
    const event = await webhook().receive(body, authHeader);
    if (event.egressInfo) await applyEgressInfo(event.egressInfo);
  },

  /** Completed, playable replays for a room (newest first). */
  async listForRoom(roomId: string) {
    await reconcileRoom(roomId);
    const rows = await prisma.recording.findMany({
      // RECO-02: gate by room privacy like `listRecent`. Without this any
      // authenticated user could enumerate roomIds and pull the public CDN
      // `fileUrl` of private rooms' replays (IDOR).
      where: { roomId, status: 'COMPLETED', fileUrl: { not: null }, room: { isPrivate: false } },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(serialize);
  },

  /** Recent public replays across all rooms — powers the Replays feed. */
  async listRecent(limit: number) {
    const rows = await prisma.recording.findMany({
      where: { status: 'COMPLETED', fileUrl: { not: null }, room: { isPrivate: false } },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        room: { select: { id: true, title: true, host: { select: publicUser } } },
      },
    });
    return rows.map(r => ({
      ...serialize(r),
      room: { id: r.room.id, title: r.room.title, host: r.room.host },
    }));
  },
};
