export {};

process.env.DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://chathouse:chathouse@localhost:5434/chathouse_test?schema=public';

/* eslint-disable @typescript-eslint/no-require-imports */
const { prisma } = require('../src/config/database') as typeof import('../src/config/database');
const { mediaService } =
  require('../src/modules/media/media.service') as typeof import('../src/modules/media/media.service');
const { privateObjectStore } =
  require('../src/modules/media/object-storage') as typeof import('../src/modules/media/object-storage');
const { legacyStableMediaUrlFor } =
  require('../src/modules/media/media-url') as typeof import('../src/modules/media/media-url');
/* eslint-enable @typescript-eslint/no-require-imports */

const rand = () => Math.random().toString(36).slice(2, 10);
const oldAt = (now: Date): Date => new Date(now.getTime() - 72 * 60 * 60 * 1000);
const delay = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

const createUser = async () => {
  const suffix = `${rand()}_${rand()}`;
  return prisma.user.create({
    data: { username: `media_${suffix}`, email: `media_${suffix}@test.local` },
    select: { id: true },
  });
};

const createOldVoice = async (ownerId: string, now: Date) => {
  const stored = await mediaService.store({
    ownerId,
    kind: 'VOICE',
    extension: 'wav',
    mimeType: 'audio/wav',
    body: Buffer.from(`RIFF-${rand()}-WAVE`),
    requestOrigin: 'http://localhost',
  });
  await prisma.mediaObject.update({
    where: { id: stored.id },
    data: { createdAt: oldAt(now), uploadCompletedAt: oldAt(now) },
  });
  return stored;
};

const createLegacyVoiceMetadata = async (ownerId: string, now: Date) => {
  const mediaId = `legacy-race-${rand()}`;
  const storageKey = `${ownerId}/voice/${mediaId}.wav`;
  const body = Buffer.from(`RIFF-${mediaId}-WAVE`);
  await privateObjectStore.put(storageKey, body, 'audio/wav');
  await prisma.$executeRaw`
    INSERT INTO "MediaObject"
      ("id", "ownerId", "storageKey", "kind", "mimeType", "sizeBytes", "createdAt")
    VALUES
      (${mediaId}, ${ownerId}, ${storageKey}, 'VOICE'::"MediaKind",
       'audio/wav', ${body.byteLength}, ${oldAt(now)})
  `;
  return {
    mediaId,
    storageKey,
    url: legacyStableMediaUrlFor(mediaId, 'http://localhost'),
  };
};

describe('Private media lifecycle cleanup', () => {
  const userIds: string[] = [];

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    for (const userId of userIds) {
      await mediaService.deleteAllForUser(userId).catch(() => undefined);
      await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
    }
    await prisma.$disconnect();
  });

  it('deletes an old voice upload only when no message is attached', async () => {
    const owner = await createUser();
    userIds.push(owner.id);
    const now = new Date();
    const voice = await createOldVoice(owner.id, now);

    await expect(mediaService.purgeAbandonedMedia(now)).resolves.toEqual({
      deleted: 1,
      failed: 0,
    });
    await expect(prisma.mediaObject.findUnique({ where: { id: voice.id } })).resolves.toBeNull();
  });

  it('purges an incomplete avatar after the replay window without touching completed avatars', async () => {
    const owner = await createUser();
    userIds.push(owner.id);
    const now = new Date();
    const incompleteId = `incomplete-avatar-${rand()}`;
    const incompleteKey = `${owner.id}/avatar/${incompleteId}.png`;
    await privateObjectStore.put(incompleteKey, Buffer.from('partial-avatar'), 'image/png');
    await prisma.mediaObject.create({
      data: {
        id: incompleteId,
        ownerId: owner.id,
        storageKey: incompleteKey,
        kind: 'AVATAR',
        mimeType: 'image/png',
        sizeBytes: 14,
        createdAt: oldAt(now),
        uploadCompletedAt: null,
      },
    });
    const completed = await mediaService.store({
      ownerId: owner.id,
      kind: 'AVATAR',
      extension: 'png',
      mimeType: 'image/png',
      body: Buffer.from('completed-avatar'),
      requestOrigin: 'http://localhost',
    });
    await prisma.mediaObject.update({
      where: { id: completed.id },
      data: { createdAt: oldAt(now), uploadCompletedAt: oldAt(now) },
    });

    await expect(mediaService.purgeAbandonedMedia(now)).resolves.toEqual({
      deleted: 1,
      failed: 0,
    });
    await expect(
      prisma.mediaObject.findUnique({ where: { id: incompleteId } }),
    ).resolves.toBeNull();
    await expect(
      prisma.mediaObject.findUnique({ where: { id: completed.id } }),
    ).resolves.not.toBeNull();
  });

  it('removes pending metadata immediately when an unkeyed storage upload fails', async () => {
    const owner = await createUser();
    userIds.push(owner.id);
    jest.spyOn(privateObjectStore, 'put').mockRejectedValueOnce(new Error('storage offline'));

    await expect(
      mediaService.store({
        ownerId: owner.id,
        kind: 'AVATAR',
        extension: 'png',
        mimeType: 'image/png',
        body: Buffer.from('avatar-bytes'),
        requestOrigin: 'http://localhost',
      }),
    ).rejects.toThrow('storage offline');
    await expect(prisma.mediaObject.count({ where: { ownerId: owner.id } })).resolves.toBe(0);
  });

  it('keeps a keyed failed upload replayable at the same metadata row', async () => {
    const owner = await createUser();
    userIds.push(owner.id);
    const idempotencyKey = `media-repair-${rand()}-${rand()}`;
    const input = {
      ownerId: owner.id,
      kind: 'VOICE' as const,
      extension: 'wav',
      mimeType: 'audio/wav',
      body: Buffer.from('RIFF-repairable-WAVE'),
      requestOrigin: 'http://localhost',
      idempotencyKey,
    };
    jest.spyOn(privateObjectStore, 'put').mockRejectedValueOnce(new Error('storage offline'));

    await expect(mediaService.store(input)).rejects.toThrow('storage offline');
    const pending = await prisma.mediaObject.findFirstOrThrow({
      where: { ownerId: owner.id, kind: 'VOICE' },
      select: { id: true, uploadCompletedAt: true },
    });
    expect(pending.uploadCompletedAt).toBeNull();

    jest.restoreAllMocks();
    const repaired = await mediaService.store(input);
    expect(repaired.id).toBe(pending.id);
    await expect(
      prisma.mediaObject.findUnique({
        where: { id: pending.id },
        select: { uploadCompletedAt: true },
      }),
    ).resolves.toEqual({ uploadCompletedAt: expect.any(Date) });
    await expect(
      prisma.mediaObject.count({ where: { ownerId: owner.id, kind: 'VOICE' } }),
    ).resolves.toBe(1);
  });

  it('preserves readable bytes when an unkeyed finalization commits but its response is lost', async () => {
    const owner = await createUser();
    userIds.push(owner.id);
    const body = Buffer.from('avatar-finalization');
    jest.spyOn(prisma.mediaObject, 'updateMany').mockImplementationOnce((async () => {
      await prisma.$executeRaw`
          UPDATE "MediaObject"
          SET "uploadCompletedAt" = NOW()
          WHERE "ownerId" = ${owner.id}
            AND "uploadCompletedAt" IS NULL
        `;
      throw new Error('database acknowledgement lost');
    }) as never);

    await expect(
      mediaService.store({
        ownerId: owner.id,
        kind: 'AVATAR',
        extension: 'png',
        mimeType: 'image/png',
        body,
        requestOrigin: 'http://localhost',
      }),
    ).rejects.toThrow('database acknowledgement lost');

    const row = await prisma.mediaObject.findFirstOrThrow({
      where: { ownerId: owner.id },
      select: { storageKey: true, uploadCompletedAt: true },
    });
    expect(row.uploadCompletedAt).toEqual(expect.any(Date));
    const opened = await privateObjectStore.open(row.storageKey);
    const chunks: Buffer[] = [];
    for await (const chunk of opened.body) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    expect(Buffer.concat(chunks)).toEqual(body);
  });

  it('preserves voice bytes referenced by either a direct or group message', async () => {
    const owner = await createUser();
    const receiver = await createUser();
    userIds.push(owner.id, receiver.id);
    const now = new Date();
    const directVoice = await createOldVoice(owner.id, now);
    const groupVoice = await createOldVoice(owner.id, now);
    const directUrl = mediaService.canonicalizeVoiceMediaUrl(directVoice.url);
    const groupUrl = mediaService.canonicalizeVoiceMediaUrl(groupVoice.url);
    const conversation = await prisma.conversation.create({
      data: {
        ownerId: owner.id,
        title: `Media cleanup ${rand()}`,
        members: { create: { userId: owner.id } },
      },
      select: { id: true },
    });
    await prisma.message.create({
      data: {
        senderId: owner.id,
        receiverId: receiver.id,
        kind: 'VOICE',
        audioUrl: directUrl,
        audioDurationMs: 1_000,
        mediaObjectId: directVoice.id,
      },
    });
    await prisma.groupMessage.create({
      data: {
        conversationId: conversation.id,
        senderId: owner.id,
        kind: 'VOICE',
        audioUrl: groupUrl,
        audioDurationMs: 1_000,
        mediaObjectId: groupVoice.id,
      },
    });

    await expect(mediaService.purgeAbandonedMedia(now)).resolves.toEqual({
      deleted: 0,
      failed: 0,
    });
    expect(
      await prisma.mediaObject.count({
        where: { id: { in: [directVoice.id, groupVoice.id] } },
      }),
    ).toBe(2);
  });

  it('protects voice media written by a rollback image after the migration', async () => {
    const owner = await createUser();
    const receiver = await createUser();
    userIds.push(owner.id, receiver.id);
    const now = new Date();
    const conversation = await prisma.conversation.create({
      data: {
        ownerId: owner.id,
        title: `Legacy media ${rand()}`,
        members: { create: { userId: owner.id } },
      },
      select: { id: true },
    });
    const legacyRows = [
      { mediaId: `legacy-direct-${rand()}`, messageId: `legacy-message-${rand()}` },
      { mediaId: `legacy-group-${rand()}`, messageId: `legacy-group-message-${rand()}` },
    ];

    for (const legacy of legacyRows) {
      const storageKey = `${owner.id}/voice/${legacy.mediaId}.wav`;
      const body = Buffer.from(`RIFF-${legacy.mediaId}-WAVE`);
      await privateObjectStore.put(storageKey, body, 'audio/wav');
      // Deliberately omit uploadCompletedAt: this is the INSERT shape emitted
      // by an API image built before the lifecycle columns existed.
      await prisma.$executeRaw`
        INSERT INTO "MediaObject"
          ("id", "ownerId", "storageKey", "kind", "mimeType", "sizeBytes", "createdAt")
        VALUES
          (${legacy.mediaId}, ${owner.id}, ${storageKey}, 'VOICE'::"MediaKind",
           'audio/wav', ${body.byteLength}, ${oldAt(now)})
      `;
    }

    const directUrl = legacyStableMediaUrlFor(legacyRows[0]!.mediaId, 'http://localhost');
    const groupUrl = legacyStableMediaUrlFor(legacyRows[1]!.mediaId, 'http://localhost');
    // Deliberately omit mediaObjectId from both legacy message shapes. The
    // migration trigger must establish the durable relation before INSERT.
    await prisma.$executeRaw`
      INSERT INTO "Message"
        ("id", "senderId", "receiverId", "kind", "audioUrl", "audioDurationMs", "createdAt")
      VALUES
        (${legacyRows[0]!.messageId}, ${owner.id}, ${receiver.id}, 'VOICE'::"MessageKind",
         ${directUrl}, 1000, ${oldAt(now)})
    `;
    await prisma.$executeRaw`
      INSERT INTO "GroupMessage"
        ("id", "conversationId", "senderId", "kind", "audioUrl", "audioDurationMs", "createdAt")
      VALUES
        (${legacyRows[1]!.messageId}, ${conversation.id}, ${owner.id}, 'VOICE'::"MessageKind",
         ${groupUrl}, 1000, ${oldAt(now)})
    `;

    await expect(
      prisma.mediaObject.findMany({
        where: { id: { in: legacyRows.map(row => row.mediaId) } },
        select: { uploadCompletedAt: true },
      }),
    ).resolves.toEqual([
      { uploadCompletedAt: expect.any(Date) },
      { uploadCompletedAt: expect.any(Date) },
    ]);
    await expect(
      prisma.message.findUnique({
        where: { id: legacyRows[0]!.messageId },
        select: { mediaObjectId: true },
      }),
    ).resolves.toEqual({ mediaObjectId: legacyRows[0]!.mediaId });
    await expect(
      prisma.groupMessage.findUnique({
        where: { id: legacyRows[1]!.messageId },
        select: { mediaObjectId: true },
      }),
    ).resolves.toEqual({ mediaObjectId: legacyRows[1]!.mediaId });

    await expect(mediaService.purgeAbandonedMedia(now)).resolves.toEqual({
      deleted: 0,
      failed: 0,
    });
    await expect(
      prisma.mediaObject.count({
        where: { id: { in: legacyRows.map(row => row.mediaId) } },
      }),
    ).resolves.toBe(2);
  });

  it('lets a rollback attachment that holds the media lock defeat a concurrent cleanup claim', async () => {
    const owner = await createUser();
    const receiver = await createUser();
    userIds.push(owner.id, receiver.id);
    const now = new Date();
    const legacy = await createLegacyVoiceMetadata(owner.id, now);
    const messageId = `legacy-lock-winner-${rand()}`;
    let announceInsert!: () => void;
    let releaseInsert!: () => void;
    const inserted = new Promise<void>(resolve => {
      announceInsert = resolve;
    });
    const release = new Promise<void>(resolve => {
      releaseInsert = resolve;
    });

    const insertTransaction = prisma.$transaction(
      async tx => {
        await tx.$executeRaw`
          INSERT INTO "Message"
            ("id", "senderId", "receiverId", "kind", "audioUrl", "audioDurationMs", "createdAt")
          VALUES
            (${messageId}, ${owner.id}, ${receiver.id}, 'VOICE'::"MessageKind",
             ${legacy.url}, 1000, ${oldAt(now)})
        `;
        announceInsert();
        await release;
      },
      { timeout: 10_000 },
    );
    await inserted;

    let cleanupSettled = false;
    const cleanup = mediaService.purgeAbandonedMedia(now).finally(() => {
      cleanupSettled = true;
    });
    try {
      // The candidate scan cannot see the uncommitted message, but its claim
      // must wait behind the trigger's MediaObject row lock.
      await delay(100);
      expect(cleanupSettled).toBe(false);
    } finally {
      releaseInsert();
    }

    await insertTransaction;
    await expect(cleanup).resolves.toEqual({ deleted: 0, failed: 0 });
    await expect(
      prisma.message.findUnique({ where: { id: messageId }, select: { mediaObjectId: true } }),
    ).resolves.toEqual({ mediaObjectId: legacy.mediaId });
    await expect(
      prisma.mediaObject.findUnique({ where: { id: legacy.mediaId } }),
    ).resolves.not.toBeNull();
  });

  it('rejects a rollback attachment when a concurrent cleanup claim wins first', async () => {
    const owner = await createUser();
    const receiver = await createUser();
    userIds.push(owner.id, receiver.id);
    const now = new Date();
    const legacy = await createLegacyVoiceMetadata(owner.id, now);
    const messageId = `legacy-claim-winner-${rand()}`;
    let announceClaim!: () => void;
    let releaseClaim!: () => void;
    const claimed = new Promise<void>(resolve => {
      announceClaim = resolve;
    });
    const release = new Promise<void>(resolve => {
      releaseClaim = resolve;
    });

    const claimTransaction = prisma.$transaction(
      async tx => {
        await tx.$queryRaw`
          SELECT id FROM "MediaObject" WHERE id = ${legacy.mediaId} FOR NO KEY UPDATE
        `;
        await tx.mediaObject.update({
          where: { id: legacy.mediaId },
          data: { deletionClaimedAt: now },
        });
        announceClaim();
        await release;
      },
      { timeout: 10_000 },
    );
    await claimed;

    let insertSettled = false;
    const insertOutcome = prisma.$executeRaw`
        INSERT INTO "Message"
          ("id", "senderId", "receiverId", "kind", "audioUrl", "audioDurationMs", "createdAt")
        VALUES
          (${messageId}, ${owner.id}, ${receiver.id}, 'VOICE'::"MessageKind",
           ${legacy.url}, 1000, ${oldAt(now)})
      `
      .then(
        () => ({ ok: true as const, error: null }),
        error => ({ ok: false as const, error }),
      )
      .finally(() => {
        insertSettled = true;
      });
    try {
      await delay(100);
      expect(insertSettled).toBe(false);
    } finally {
      releaseClaim();
    }

    await claimTransaction;
    const outcome = await insertOutcome;
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toBeInstanceOf(Error);
    await expect(prisma.message.count({ where: { id: messageId } })).resolves.toBe(0);
    await expect(
      prisma.mediaObject.findUnique({
        where: { id: legacy.mediaId },
        select: { deletionClaimedAt: true },
      }),
    ).resolves.toEqual({ deletionClaimedAt: now });
    // Do not let this deliberately claimed orphan become a candidate in a
    // later test that advances the cleanup clock beyond the claim TTL.
    await privateObjectStore.delete(legacy.storageKey);
    await prisma.mediaObject.delete({ where: { id: legacy.mediaId } });
  });

  it('does not full-scan message histories for each abandoned candidate', async () => {
    const owner = await createUser();
    userIds.push(owner.id);
    const now = new Date();
    const voice = await createOldVoice(owner.id, now);
    const directScan = jest.spyOn(prisma.message, 'findMany');
    const groupScan = jest.spyOn(prisma.groupMessage, 'findMany');

    await expect(mediaService.purgeAbandonedMedia(now)).resolves.toEqual({
      deleted: 1,
      failed: 0,
    });
    expect(directScan).not.toHaveBeenCalled();
    expect(groupScan).not.toHaveBeenCalled();
    await expect(prisma.mediaObject.findUnique({ where: { id: voice.id } })).resolves.toBeNull();
  });

  it('releases its claim after storage failure and succeeds on the next run', async () => {
    const owner = await createUser();
    userIds.push(owner.id);
    const now = new Date();
    const voice = await createOldVoice(owner.id, now);
    jest.spyOn(privateObjectStore, 'delete').mockRejectedValueOnce(new Error('storage offline'));

    await expect(mediaService.purgeAbandonedMedia(now)).resolves.toEqual({
      deleted: 0,
      failed: 1,
    });
    await expect(
      prisma.mediaObject.findUnique({
        where: { id: voice.id },
        select: { deletionClaimedAt: true },
      }),
    ).resolves.toEqual({ deletionClaimedAt: null });

    jest.restoreAllMocks();
    await expect(mediaService.purgeAbandonedMedia(now)).resolves.toEqual({
      deleted: 1,
      failed: 0,
    });
  });

  it('recovers a stale database claim after bytes were already deleted', async () => {
    const owner = await createUser();
    userIds.push(owner.id);
    const now = new Date();
    const voice = await createOldVoice(owner.id, now);
    jest
      .spyOn(prisma.mediaObject, 'deleteMany')
      .mockRejectedValueOnce(new Error('database offline'));

    await expect(mediaService.purgeAbandonedMedia(now)).resolves.toEqual({
      deleted: 0,
      failed: 1,
    });
    await expect(
      prisma.mediaObject.findUnique({
        where: { id: voice.id },
        select: { deletionClaimedAt: true },
      }),
    ).resolves.toEqual({ deletionClaimedAt: now });

    jest.restoreAllMocks();
    const afterClaimExpiry = new Date(now.getTime() + 61 * 60 * 1000);
    await expect(mediaService.purgeAbandonedMedia(afterClaimExpiry)).resolves.toEqual({
      deleted: 1,
      failed: 0,
    });
  });
});
