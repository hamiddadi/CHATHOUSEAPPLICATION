/**
 * Room recording (LiveKit Egress) integration tests.
 *
 * Mocks the livekit-server-sdk (EgressClient/WebhookReceiver) but uses the REAL
 * Prisma layer (docker Postgres on :5433) so the Recording rows are asserted
 * against the DB. Egress env is set so the feature is "configured". Covers the
 * untested module the audit flagged: start gating/dedup + the replay listing.
 */
process.env.DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://chathouse:chathouse@localhost:5433/chathouse?schema=public';
process.env.REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
process.env.EGRESS_ENABLED = 'true';
process.env.LIVEKIT_URL = 'wss://livekit.test';
process.env.LIVEKIT_API_KEY = 'lk_key';
process.env.LIVEKIT_API_SECRET = 'lk_secret';
process.env.RECORDING_S3_BUCKET = 'bucket';
process.env.RECORDING_S3_ACCESS_KEY = 'ak';
process.env.RECORDING_S3_SECRET = 'sk';
process.env.RECORDING_PUBLIC_BASE_URL = 'https://cdn.test';

// Self-contained mock of the LiveKit server SDK (no outer refs → jest-hoist safe).
jest.mock('livekit-server-sdk', () => {
  let n = 0;
  class EgressClient {
    async startRoomCompositeEgress() {
      n += 1;
      return {
        egressId: `eg_${n}_${Date.now()}`,
        status: 0,
        startedAt: 0n,
        endedAt: 0n,
        fileResults: [],
      };
    }
    async stopEgress() {
      return { egressId: 'eg_stop', status: 3, startedAt: 0n, endedAt: 0n, fileResults: [] };
    }
    async listEgress() {
      return [] as unknown[];
    }
  }
  class WebhookReceiver {
    async receive() {
      return { id: 'evt', type: 'egress_ended', data: { object: {} } };
    }
  }
  class EncodedFileOutput {}
  class S3Upload {}
  const EgressStatus = {
    EGRESS_STARTING: 0,
    EGRESS_ACTIVE: 1,
    EGRESS_ENDING: 2,
    EGRESS_COMPLETE: 3,
    EGRESS_FAILED: 4,
    EGRESS_ABORTED: 5,
  };
  const EncodedFileType = { DEFAULT_FILETYPE: 0, MP4: 1, OGG: 2 };
  return {
    __esModule: true,
    EgressClient,
    WebhookReceiver,
    EncodedFileOutput,
    S3Upload,
    EgressStatus,
    EncodedFileType,
  };
});

/* eslint-disable @typescript-eslint/no-require-imports */
const { prisma } = require('../src/config/database') as typeof import('../src/config/database');
const { recordingsService } =
  require('../src/modules/recordings/recordings.service') as typeof import('../src/modules/recordings/recordings.service');
/* eslint-enable @typescript-eslint/no-require-imports */

const rand = () => Math.random().toString(36).slice(2, 10);
const createdUserIds: string[] = [];

const seedRoom = async (): Promise<string> => {
  const host = await prisma.user.create({
    data: { username: `rec_${rand()}`, email: `rec_${rand()}@test.local` },
    select: { id: true },
  });
  createdUserIds.push(host.id);
  const room = await prisma.room.create({
    data: { title: `Rec room ${rand()}`, hostId: host.id },
    select: { id: true },
  });
  return room.id;
};

afterAll(async () => {
  // Deleting the host cascades to the room and its recordings.
  for (const id of createdUserIds) {
    await prisma.user.delete({ where: { id } }).catch(() => undefined);
  }
  await prisma.$disconnect();
});

describe('recordingsService.startForRoom', () => {
  it('creates a STARTING recording and is a no-op while one is already live', async () => {
    const roomId = await seedRoom();

    const first = await recordingsService.startForRoom(roomId);
    expect(first?.egressId).toBeTruthy();

    const row = await prisma.recording.findFirst({ where: { roomId } });
    expect(row?.status).toBe('STARTING');

    // A recording is already STARTING → second call must not start another.
    const second = await recordingsService.startForRoom(roomId);
    expect(second).toBeNull();
    const count = await prisma.recording.count({ where: { roomId } });
    expect(count).toBe(1);
  });
});

describe('recordingsService.listForRoom', () => {
  it('returns only COMPLETED recordings that have a playback URL', async () => {
    const roomId = await seedRoom();
    await prisma.recording.create({
      data: {
        roomId,
        egressId: `eg_done_${rand()}`,
        status: 'COMPLETED',
        fileUrl: 'https://cdn.test/recordings/x.ogg',
        durationMs: 1234,
      },
    });
    await prisma.recording.create({
      data: { roomId, egressId: `eg_pending_${rand()}`, status: 'STARTING' },
    });

    const replays = await recordingsService.listForRoom(roomId);
    expect(replays).toHaveLength(1);
    expect(replays[0]?.fileUrl).toBe('https://cdn.test/recordings/x.ogg');
    expect(replays[0]?.status).toBe('COMPLETED');
  });
});

export {};
