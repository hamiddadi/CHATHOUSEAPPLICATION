import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { prisma } from '../src/config/database';
import { mediaReferenceFor } from '../src/modules/media/media-url';
import {
  MEDIA_OBJECT_DELETE_TOPIC,
  mediaDeletionOutboxData,
  wakeMediaDeletion,
} from '../src/modules/media/media-deletion.outbox';
import { privateObjectStore } from '../src/modules/media/object-storage';
import { mediaService } from '../src/modules/media/media.service';
import { hardDeleteUserWithRelationalRepair } from '../src/workers/gdpr-purge.worker';
import { processOutboxBatch } from '../src/workers/outbox.worker';

const suffix = (): string => randomUUID().replace(/-/g, '').slice(0, 12);

const explicitMigrationDatabaseUrl = process.env.TEST_MIGRATION_DATABASE_URL;
// Role-separated CI must supply the dedicated admin URL. Ordinary `npm test`
// uses setup.env's disposable admin DATABASE_URL, so preserve that safe local
// fallback instead of making the default suite require extra configuration.
const migrationDatabaseUrl = explicitMigrationDatabaseUrl ?? process.env.DATABASE_URL;
let migrationPrisma: PrismaClient | null = null;

/**
 * Test-only DDL must never borrow the application's runtime Prisma role. The
 * production-like suite deliberately removes CREATE on the public schema from
 * that role; TEST_MIGRATION_DATABASE_URL is the explicit administrative lane
 * used only to install/remove this rollback fixture.
 */
const migrationDdlClient = (): PrismaClient => {
  if (process.env.TEST_APP_DATABASE_URL && !explicitMigrationDatabaseUrl) {
    throw new Error(
      '[gdpr-media-outbox] TEST_MIGRATION_DATABASE_URL is required with TEST_APP_DATABASE_URL',
    );
  }
  if (!migrationDatabaseUrl) {
    throw new Error(
      '[gdpr-media-outbox] a test-scoped migration DATABASE_URL is required for test-only DDL',
    );
  }

  let databaseName: string;
  try {
    databaseName =
      decodeURIComponent(new URL(migrationDatabaseUrl).pathname)
        .replace(/^\/+/, '')
        .split('/')[0] ?? '';
  } catch {
    throw new Error('[gdpr-media-outbox] TEST_MIGRATION_DATABASE_URL must be a valid URL');
  }
  if (!/(^|[_-])test($|[_-])/iu.test(databaseName)) {
    throw new Error(
      `[gdpr-media-outbox] refusing test-only DDL on non-test database "${databaseName}"`,
    );
  }

  migrationPrisma ??= new PrismaClient({
    datasources: { db: { url: migrationDatabaseUrl } },
  });
  return migrationPrisma;
};

const readObject = async (storageKey: string): Promise<Buffer> => {
  const opened = await privateObjectStore.open(storageKey);
  const chunks: Buffer[] = [];
  for await (const chunk of opened.body) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
};

const makeUser = async () =>
  prisma.user.create({
    data: { username: `gdpr_media_${suffix()}` },
    select: { id: true },
  });

const storeMedia = async (ownerId: string, kind: 'AVATAR' | 'VOICE', body: Buffer) => {
  const stored = await mediaService.store({
    ownerId,
    kind,
    extension: kind === 'AVATAR' ? 'png' : 'm4a',
    mimeType: kind === 'AVATAR' ? 'image/png' : 'audio/mp4',
    body,
    requestOrigin: 'http://localhost:3000',
    idempotencyKey: `gdpr-media-${suffix()}`,
  });
  const row = await prisma.mediaObject.findUniqueOrThrow({
    where: { id: stored.id },
    select: { id: true, storageKey: true },
  });
  return { ...stored, storageKey: row.storageKey };
};

describe('GDPR media deletion outbox', () => {
  const userIds = new Set<string>();
  const eventKeys = new Set<string>();
  const storageKeys = new Set<string>();

  afterEach(async () => {
    if (userIds.size > 0) {
      await prisma.user.deleteMany({ where: { id: { in: [...userIds] } } });
      userIds.clear();
    }
    if (eventKeys.size > 0) {
      await prisma.outboxEvent.deleteMany({ where: { eventKey: { in: [...eventKeys] } } });
      eventKeys.clear();
    }
    await Promise.all([...storageKeys].map(key => privateObjectStore.delete(key)));
    storageKeys.clear();
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    const disconnects: Array<Promise<void>> = [prisma.$disconnect()];
    if (migrationPrisma) disconnects.push(migrationPrisma.$disconnect());
    await Promise.all(disconnects);
  });

  it('keeps bytes untouched on SQL rollback, then deletes them only after a committed retry', async () => {
    // Fail before creating business/media fixtures if the explicit admin lane
    // for this test-only DDL was not configured.
    const ddl = migrationDdlClient();
    const victim = await makeUser();
    userIds.add(victim.id);
    const bytes = Buffer.from(`rollback-proof-${suffix()}`);
    const media = await storeMedia(victim.id, 'AVATAR', bytes);
    storageKeys.add(media.storageKey);
    const eventKey = `${MEDIA_OBJECT_DELETE_TOPIC}:${media.id}`;
    eventKeys.add(eventKey);
    const deleteSpy = jest.spyOn(privateObjectStore, 'delete');
    const ddlSuffix = suffix();
    const functionName = `gdpr_test_fail_user_delete_${ddlSuffix}`;
    const triggerName = `gdpr_test_fail_user_delete_${ddlSuffix}`;

    try {
      await ddl.$executeRawUnsafe(`
        CREATE FUNCTION "${functionName}"() RETURNS trigger
        LANGUAGE plpgsql AS $$
        BEGIN
          RAISE EXCEPTION 'forced GDPR transaction failure';
        END;
        $$
      `);
      await ddl.$executeRawUnsafe(`
        CREATE TRIGGER "${triggerName}"
        BEFORE DELETE ON "User"
        FOR EACH ROW EXECUTE FUNCTION "${functionName}"()
      `);

      await expect(hardDeleteUserWithRelationalRepair(victim.id)).rejects.toThrow(
        'forced GDPR transaction failure',
      );
      await expect(prisma.user.findUnique({ where: { id: victim.id } })).resolves.not.toBeNull();
      await expect(
        prisma.mediaObject.findUnique({ where: { id: media.id } }),
      ).resolves.not.toBeNull();
      await expect(prisma.outboxEvent.findUnique({ where: { eventKey } })).resolves.toBeNull();
      await expect(readObject(media.storageKey)).resolves.toEqual(bytes);
      expect(deleteSpy).not.toHaveBeenCalled();
    } finally {
      const cleanupErrors: unknown[] = [];
      try {
        await ddl.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${triggerName}" ON "User"`);
      } catch (error) {
        cleanupErrors.push(error);
      }
      try {
        // CASCADE is a fail-safe if trigger removal itself failed after the
        // function was created. Names are random and confined to this test DB.
        await ddl.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${functionName}"() CASCADE`);
      } catch (error) {
        cleanupErrors.push(error);
      }
      if (cleanupErrors.length > 0) {
        throw new AggregateError(cleanupErrors, 'failed to clean GDPR rollback DDL fixture');
      }
    }

    expect(await hardDeleteUserWithRelationalRepair(victim.id)).toBe(true);
    userIds.delete(victim.id);
    await expect(prisma.user.findUnique({ where: { id: victim.id } })).resolves.toBeNull();
    await expect(prisma.mediaObject.findUnique({ where: { id: media.id } })).resolves.toBeNull();
    await expect(readObject(media.storageKey)).resolves.toEqual(bytes);
    expect(deleteSpy).not.toHaveBeenCalled();

    const pending = await prisma.outboxEvent.findUniqueOrThrow({ where: { eventKey } });
    expect(pending).toMatchObject({ status: 'PENDING', deliveredAt: null });
    expect(pending.payload).toEqual({ mediaId: media.id, storageKey: media.storageKey });

    expect(
      await processOutboxBatch({ topic: MEDIA_OBJECT_DELETE_TOPIC, aggregateId: media.id }),
    ).toBe(1);
    await expect(privateObjectStore.open(media.storageKey)).rejects.toThrow();
    expect(deleteSpy).toHaveBeenCalledTimes(1);
    await expect(prisma.outboxEvent.findUnique({ where: { eventKey } })).resolves.toMatchObject({
      status: 'DELIVERED',
      payload: { mediaId: media.id, deleted: true },
    });
  });

  it('neutralizes a surviving club icon/cover and report audio before media metadata cascades', async () => {
    const victim = await makeUser();
    const successor = await makeUser();
    userIds.add(victim.id);
    userIds.add(successor.id);
    const avatarBytes = Buffer.from(`club-avatar-${suffix()}`);
    const voiceBytes = Buffer.from(`report-voice-${suffix()}`);
    const avatar = await storeMedia(victim.id, 'AVATAR', avatarBytes);
    const voice = await storeMedia(victim.id, 'VOICE', voiceBytes);
    storageKeys.add(avatar.storageKey);
    storageKeys.add(voice.storageKey);
    eventKeys.add(`${MEDIA_OBJECT_DELETE_TOPIC}:${avatar.id}`);
    eventKeys.add(`${MEDIA_OBJECT_DELETE_TOPIC}:${voice.id}`);

    const club = await prisma.club.create({
      data: {
        name: `GDPR media ${suffix()}`,
        slug: `gdpr-media-${suffix()}`,
        ownerId: victim.id,
        iconUrl: avatar.url,
        iconMediaObjectId: avatar.id,
        memberCount: 2,
        members: {
          create: [
            { userId: victim.id, role: 'ADMIN' },
            { userId: successor.id, role: 'MODERATOR' },
          ],
        },
      },
    });
    await prisma.clubMetadata.create({
      data: {
        clubId: club.id,
        coverUrl: avatar.url,
        coverMediaObjectId: avatar.id,
      },
    });
    const evidenceId = `message-${suffix()}`;
    const snapshot = 'immutable moderation evidence';
    const report = await prisma.report.create({
      data: {
        reporterId: successor.id,
        targetKind: 'DIRECT_MESSAGE',
        reportedMessageId: evidenceId,
        contentAuthorId: victim.id,
        contentSnapshot: snapshot,
        contentAudioUrl: voice.url,
        contentMediaObjectId: voice.id,
        contentKind: 'VOICE',
        contentAudioDurationMs: 900,
        reason: 'OTHER',
      },
    });

    expect(await hardDeleteUserWithRelationalRepair(victim.id)).toBe(true);
    userIds.delete(victim.id);

    await expect(
      prisma.club.findUnique({
        where: { id: club.id },
        select: { ownerId: true, iconUrl: true, iconMediaObjectId: true },
      }),
    ).resolves.toEqual({
      ownerId: successor.id,
      iconUrl: null,
      iconMediaObjectId: null,
    });
    await expect(
      prisma.clubMetadata.findUnique({
        where: { clubId: club.id },
        select: { coverUrl: true, coverMediaObjectId: true },
      }),
    ).resolves.toEqual({ coverUrl: null, coverMediaObjectId: null });
    await expect(
      prisma.report.findUnique({
        where: { id: report.id },
        select: {
          contentAuthorId: true,
          contentAudioUrl: true,
          contentMediaObjectId: true,
          contentSnapshot: true,
          reportedMessageId: true,
        },
      }),
    ).resolves.toEqual({
      contentAuthorId: null,
      contentAudioUrl: null,
      contentMediaObjectId: null,
      contentSnapshot: snapshot,
      reportedMessageId: evidenceId,
    });
    await expect(
      prisma.mediaObject.count({ where: { id: { in: [avatar.id, voice.id] } } }),
    ).resolves.toBe(0);
    await expect(readObject(avatar.storageKey)).resolves.toEqual(avatarBytes);
    await expect(readObject(voice.storageKey)).resolves.toEqual(voiceBytes);

    expect(
      await processOutboxBatch({ topic: MEDIA_OBJECT_DELETE_TOPIC, aggregateId: avatar.id }),
    ).toBe(1);
    expect(
      await processOutboxBatch({ topic: MEDIA_OBJECT_DELETE_TOPIC, aggregateId: voice.id }),
    ).toBe(1);
    await expect(privateObjectStore.open(avatar.storageKey)).rejects.toThrow();
    await expect(privateObjectStore.open(voice.storageKey)).rejects.toThrow();
  });

  it('retains the storage key and retries when object deletion fails transiently', async () => {
    const victim = await makeUser();
    userIds.add(victim.id);
    const bytes = Buffer.from(`storage-retry-${suffix()}`);
    const media = await storeMedia(victim.id, 'VOICE', bytes);
    storageKeys.add(media.storageKey);
    const eventKey = `${MEDIA_OBJECT_DELETE_TOPIC}:${media.id}`;
    eventKeys.add(eventKey);

    expect(await hardDeleteUserWithRelationalRepair(victim.id)).toBe(true);
    userIds.delete(victim.id);
    const originalDelete = privateObjectStore.delete.bind(privateObjectStore);
    const deleteSpy = jest
      .spyOn(privateObjectStore, 'delete')
      .mockRejectedValueOnce(new Error('storage offline'))
      .mockImplementation(originalDelete);

    expect(
      await processOutboxBatch({ topic: MEDIA_OBJECT_DELETE_TOPIC, aggregateId: media.id }),
    ).toBe(1);
    await expect(readObject(media.storageKey)).resolves.toEqual(bytes);
    await expect(prisma.outboxEvent.findUnique({ where: { eventKey } })).resolves.toMatchObject({
      status: 'PENDING',
      deliveredAt: null,
      payload: { mediaId: media.id, storageKey: media.storageKey },
    });

    expect(await wakeMediaDeletion(media.id)).toBe(1);
    expect(deleteSpy).toHaveBeenCalledTimes(2);
    await expect(privateObjectStore.open(media.storageKey)).rejects.toThrow();
    await expect(prisma.outboxEvent.findUnique({ where: { eventKey } })).resolves.toMatchObject({
      status: 'DELIVERED',
      payload: { mediaId: media.id, deleted: true },
    });
  });

  it('clears legacy report audio by author even when the user owns no MediaObject', async () => {
    const victim = await makeUser();
    const reporter = await makeUser();
    userIds.add(victim.id);
    userIds.add(reporter.id);
    const evidenceId = `legacy-message-${suffix()}`;
    const report = await prisma.report.create({
      data: {
        reporterId: reporter.id,
        targetKind: 'DIRECT_MESSAGE',
        reportedMessageId: evidenceId,
        contentAuthorId: victim.id,
        contentSnapshot: 'legacy snapshot',
        contentAudioUrl: mediaReferenceFor(`missing-${suffix()}`, 'http://localhost:3000'),
        contentKind: 'VOICE',
        reason: 'OTHER',
      },
    });

    expect(await hardDeleteUserWithRelationalRepair(victim.id)).toBe(true);
    userIds.delete(victim.id);
    await expect(
      prisma.report.findUnique({
        where: { id: report.id },
        select: {
          contentAuthorId: true,
          contentAudioUrl: true,
          contentSnapshot: true,
          reportedMessageId: true,
        },
      }),
    ).resolves.toEqual({
      contentAuthorId: null,
      contentAudioUrl: null,
      contentSnapshot: 'legacy snapshot',
      reportedMessageId: evidenceId,
    });
  });

  it('fails closed and retries an unredacted deletion payload with no storage key', async () => {
    const mediaId = `malformed-${suffix()}`;
    const validEnvelope = mediaDeletionOutboxData({ id: mediaId, storageKey: 'unused/key' });
    const eventKey = String(validEnvelope.eventKey);
    eventKeys.add(eventKey);
    await prisma.outboxEvent.create({
      data: { ...validEnvelope, payload: { mediaId } },
    });
    const deleteSpy = jest.spyOn(privateObjectStore, 'delete');

    expect(
      await processOutboxBatch({ topic: MEDIA_OBJECT_DELETE_TOPIC, aggregateId: mediaId }),
    ).toBe(1);
    expect(deleteSpy).not.toHaveBeenCalled();
    await expect(prisma.outboxEvent.findUnique({ where: { eventKey } })).resolves.toMatchObject({
      status: 'PENDING',
      attempts: 1,
      deliveredAt: null,
      lastError: 'Missing storageKey in media deletion outbox payload',
    });
  });

  it('rejects an ambiguous deletion payload containing both key and completion marker', async () => {
    const mediaId = `ambiguous-${suffix()}`;
    const validEnvelope = mediaDeletionOutboxData({ id: mediaId, storageKey: 'unused/key' });
    const eventKey = String(validEnvelope.eventKey);
    eventKeys.add(eventKey);
    await prisma.outboxEvent.create({
      data: {
        ...validEnvelope,
        payload: { mediaId, storageKey: 'x', deleted: true },
      },
    });
    const deleteSpy = jest.spyOn(privateObjectStore, 'delete');

    expect(
      await processOutboxBatch({ topic: MEDIA_OBJECT_DELETE_TOPIC, aggregateId: mediaId }),
    ).toBe(1);
    expect(deleteSpy).not.toHaveBeenCalled();
    await expect(prisma.outboxEvent.findUnique({ where: { eventKey } })).resolves.toMatchObject({
      status: 'PENDING',
      attempts: 1,
      deliveredAt: null,
      lastError: 'Invalid media deletion outbox payload',
    });
  });
});
