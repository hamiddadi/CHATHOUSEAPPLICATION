import { createHash, randomUUID } from 'node:crypto';
import { MediaKind, Prisma } from '@prisma/client';
import { prisma } from '../../config/database';
import { env } from '../../config/env';
import { logger } from '../../config/logger';
import { AppError } from '../../middlewares/error.middleware';
import { runIdempotentCreate } from '../../utils/idempotency';
import { isValidMediaSignature, mediaUrlFor } from './media-url';
import { privateObjectStore, type ByteRange } from './object-storage';

interface StoreMediaInput {
  ownerId: string;
  kind: MediaKind;
  extension: string;
  mimeType: string;
  body: Buffer;
  requestOrigin: string;
  idempotencyKey?: string;
}

const discardUnreplayableUpload = async (media: {
  id: string;
  storageKey: string;
}): Promise<void> => {
  try {
    await privateObjectStore.delete(media.storageKey);
  } catch (error) {
    // Keep the pending metadata as a durable cleanup ledger when object-store
    // compensation is unavailable. The bounded lifecycle job retries it after
    // the idempotency-safe retention window.
    logger.warn('media: failed to compensate object bytes after upload failure', {
      err: error,
      mediaId: media.id,
    });
    return;
  }
  await prisma.mediaObject
    .deleteMany({
      where: {
        id: media.id,
        uploadCompletedAt: null,
        deletionClaimedAt: null,
        directMessages: { none: {} },
        groupMessages: { none: {} },
      },
    })
    .catch(error =>
      logger.warn('media: failed to remove pending metadata after upload failure', {
        err: error,
        mediaId: media.id,
      }),
    );
};

const store = async ({
  ownerId,
  kind,
  extension,
  mimeType,
  body,
  requestOrigin,
  idempotencyKey,
}: StoreMediaInput): Promise<{ id: string; url: string }> => {
  const bodySha256 = createHash('sha256').update(body).digest('hex');
  const creation = await runIdempotentCreate({
    userId: ownerId,
    scope: `media.upload:${kind.toLowerCase()}`,
    key: idempotencyKey,
    // Bind the key to decoded semantic content rather than the caller's base64
    // formatting. Equivalent data URLs replay; changed bytes/MIME return 409.
    payload: { kind, mimeType, sizeBytes: body.byteLength, bodySha256 },
    create: async tx => {
      const id = randomUUID();
      await tx.mediaObject.create({
        data: {
          id,
          ownerId,
          storageKey: `${ownerId}/${kind.toLowerCase()}/${id}.${extension}`,
          kind,
          mimeType,
          sizeBytes: body.byteLength,
          uploadCompletedAt: null,
        },
      });
      return id;
    },
  });

  const media = await prisma.mediaObject.findFirst({
    where: { id: creation.resourceId, ownerId, kind, deletionClaimedAt: null },
    select: { id: true, storageKey: true, uploadCompletedAt: true },
  });
  if (!media) throw new AppError('SERVER_001', 'Upload metadata is unavailable');

  // Metadata is committed before external storage. A lost response or process
  // crash therefore reuses this exact storage key and can repair an incomplete
  // upload instead of allocating another object. Concurrent retries write the
  // same payload/key and the conditional completion update converges safely.
  if (!media.uploadCompletedAt) {
    try {
      await privateObjectStore.put(media.storageKey, body, mimeType);
    } catch (error) {
      // No database finalization was attempted, so this row is still
      // provably pending. An unkeyed caller cannot repair it; compensate now
      // (the lifecycle worker retains the row if object deletion also fails).
      if (idempotencyKey === undefined) await discardUnreplayableUpload(media);
      throw error;
    }

    try {
      const completed = await prisma.mediaObject.updateMany({
        where: {
          id: media.id,
          ownerId,
          kind,
          uploadCompletedAt: null,
          deletionClaimedAt: null,
        },
        data: { uploadCompletedAt: new Date() },
      });
      if (completed.count === 0) {
        const winner = await prisma.mediaObject.findFirst({
          where: {
            id: media.id,
            ownerId,
            kind,
            uploadCompletedAt: { not: null },
            deletionClaimedAt: null,
          },
          select: { id: true },
        });
        if (!winner) throw new AppError('SERVER_001', 'Upload could not be finalized');
      }
    } catch (error) {
      // The UPDATE may have committed even if its response was lost. Once the
      // object PUT succeeded, deleting bytes here could therefore corrupt a
      // metadata row that is already marked complete. Preserve both states:
      // keyed callers can replay, and the lifecycle worker later removes a
      // row that is still provably incomplete/unattached.
      throw error;
    }
  }

  return { id: media.id, url: mediaUrlFor(media.id, requestOrigin) };
};

const getMetadataForRead = async (id: string) => {
  const media = await prisma.mediaObject.findFirst({
    where: { id, uploadCompletedAt: { not: null }, deletionClaimedAt: null },
    select: {
      storageKey: true,
      mimeType: true,
      sizeBytes: true,
      owner: { select: { deletedAt: true } },
    },
  });
  if (!media || media.owner.deletedAt) throw new AppError('NOT_FOUND_001');
  return media;
};

const openForRead = async (
  media: Awaited<ReturnType<typeof getMetadataForRead>>,
  range?: ByteRange,
) => {
  const object = await privateObjectStore.open(media.storageKey, range);
  return { ...object, mimeType: media.mimeType, sizeBytes: media.sizeBytes };
};

/**
 * Delete all private bytes owned by a user before the relational hard delete.
 * Object deletion is idempotent. Any storage failure is deliberately surfaced:
 * the GDPR worker will retry later instead of deleting the metadata and
 * orphaning personal data in the bucket.
 */
const deleteAllForUser = async (userId: string): Promise<number> => {
  const rows = await prisma.mediaObject.findMany({
    where: { ownerId: userId },
    select: { storageKey: true },
    orderBy: { createdAt: 'asc' },
  });

  for (let index = 0; index < rows.length; index += 10) {
    const batch = rows.slice(index, index + 10);
    await Promise.all(batch.map(row => privateObjectStore.delete(row.storageKey)));
  }
  return rows.length;
};

const mediaIdFromOwnedUrl = (url: string): string => {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new AppError('VALIDATION_001', 'Invalid private media URL');
  }

  if (env.PUBLIC_URL && parsed.origin !== new URL(env.PUBLIC_URL).origin) {
    throw new AppError('VALIDATION_001', 'Media URL must use the configured API origin');
  }

  const parts = parsed.pathname.split('/').filter(Boolean);
  const [prefix, id, signature] = parts;
  if (
    parts.length !== 3 ||
    prefix !== 'media' ||
    !id ||
    !signature ||
    !isValidMediaSignature(id, signature)
  ) {
    throw new AppError('VALIDATION_001', 'Invalid private media URL');
  }

  return id;
};

const assertOwnedMediaUrl = async (
  ownerId: string,
  url: string,
  expectedKind: MediaKind,
): Promise<void> => {
  const id = mediaIdFromOwnedUrl(url);
  const owned = await prisma.mediaObject.findFirst({
    where: {
      id,
      ownerId,
      kind: expectedKind,
      uploadCompletedAt: { not: null },
      deletionClaimedAt: null,
    },
    select: { id: true },
  });
  if (!owned) {
    throw new AppError('VALIDATION_001', 'Media must be uploaded by the current user');
  }
};

/**
 * Resolve and lock a media object in the caller's transaction. Voice-message
 * insertion and orphan cleanup take the same NO KEY UPDATE lock, so cleanup
 * cannot claim/delete bytes after send authorization but before the FK insert.
 */
const assertOwnedMediaUrlWithinTransaction = async (
  tx: Prisma.TransactionClient,
  ownerId: string,
  url: string,
  expectedKind: MediaKind,
): Promise<string> => {
  const id = mediaIdFromOwnedUrl(url);
  await tx.$queryRaw(Prisma.sql`SELECT id FROM "MediaObject" WHERE id = ${id} FOR NO KEY UPDATE`);
  const owned = await tx.mediaObject.findFirst({
    where: {
      id,
      ownerId,
      kind: expectedKind,
      uploadCompletedAt: { not: null },
      deletionClaimedAt: null,
    },
    select: { id: true },
  });
  if (!owned) {
    throw new AppError('VALIDATION_001', 'Media must be uploaded by the current user');
  }
  return owned.id;
};

interface MediaCleanupResult {
  deleted: number;
  failed: number;
}

interface ClaimedMedia {
  id: string;
  storageKey: string;
  claimedAt: Date;
}

const abandonedMediaWhere = (
  cutoff: Date,
  staleClaimBefore: Date,
): Prisma.MediaObjectWhereInput => ({
  createdAt: { lt: cutoff },
  AND: [
    {
      OR: [
        {
          kind: MediaKind.VOICE,
          directMessages: { none: {} },
          groupMessages: { none: {} },
        },
        { kind: MediaKind.AVATAR, uploadCompletedAt: null },
      ],
    },
    {
      OR: [{ deletionClaimedAt: null }, { deletionClaimedAt: { lt: staleClaimBefore } }],
    },
  ],
});

const claimAbandonedMedia = async (
  id: string,
  cutoff: Date,
  staleClaimBefore: Date,
  claimedAt: Date,
): Promise<ClaimedMedia | null> =>
  prisma.$transaction(async tx => {
    await tx.$queryRaw(Prisma.sql`SELECT id FROM "MediaObject" WHERE id = ${id} FOR NO KEY UPDATE`);
    const media = await tx.mediaObject.findFirst({
      where: {
        id,
        ...abandonedMediaWhere(cutoff, staleClaimBefore),
      },
      select: { id: true, storageKey: true },
    });
    if (!media) return null;

    const claimed = await tx.mediaObject.updateMany({
      where: {
        id: media.id,
        ...abandonedMediaWhere(cutoff, staleClaimBefore),
      },
      data: { deletionClaimedAt: claimedAt },
    });
    return claimed.count === 1 ? { id: media.id, storageKey: media.storageKey, claimedAt } : null;
  });

const deleteClaimedMedia = async (media: ClaimedMedia): Promise<boolean> => {
  try {
    await privateObjectStore.delete(media.storageKey);
  } catch (err) {
    await prisma.mediaObject
      .updateMany({
        where: { id: media.id, deletionClaimedAt: media.claimedAt },
        data: { deletionClaimedAt: null },
      })
      .catch(resetErr =>
        logger.warn('media-cleanup: failed to release deletion claim', {
          err: resetErr,
          mediaId: media.id,
        }),
      );
    throw err;
  }

  const removed = await prisma.mediaObject.deleteMany({
    where: {
      id: media.id,
      deletionClaimedAt: media.claimedAt,
      directMessages: { none: {} },
      groupMessages: { none: {} },
    },
  });
  return removed.count === 1;
};

const purgeAbandonedMedia = async (now = new Date()): Promise<MediaCleanupResult> => {
  const cutoff = new Date(now.getTime() - env.VOICE_MEDIA_ABANDONED_TTL_HOURS * 60 * 60 * 1000);
  const staleClaimBefore = new Date(
    now.getTime() - env.VOICE_MEDIA_DELETE_CLAIM_TTL_MINUTES * 60 * 1000,
  );
  const candidates = await prisma.mediaObject.findMany({
    where: {
      ...abandonedMediaWhere(cutoff, staleClaimBefore),
    },
    select: { id: true },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: env.VOICE_MEDIA_CLEANUP_BATCH_SIZE,
  });

  let deleted = 0;
  let failed = 0;
  for (let offset = 0; offset < candidates.length; offset += env.VOICE_MEDIA_CLEANUP_CONCURRENCY) {
    const chunk = candidates.slice(offset, offset + env.VOICE_MEDIA_CLEANUP_CONCURRENCY);
    const results = await Promise.allSettled(
      chunk.map(async candidate => {
        const claimed = await claimAbandonedMedia(candidate.id, cutoff, staleClaimBefore, now);
        return claimed ? deleteClaimedMedia(claimed) : false;
      }),
    );
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        if (result.value) deleted += 1;
      } else {
        failed += 1;
        logger.warn('media-cleanup: media deletion failed', {
          err: result.reason,
          mediaId: chunk[index]?.id,
        });
      }
    });
  }
  return { deleted, failed };
};

export const mediaService = {
  store,
  getMetadataForRead,
  openForRead,
  deleteAllForUser,
  assertOwnedMediaUrl,
  assertOwnedMediaUrlWithinTransaction,
  purgeAbandonedMedia,
};
