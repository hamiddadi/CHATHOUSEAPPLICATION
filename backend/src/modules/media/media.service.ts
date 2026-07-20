import { randomUUID } from 'node:crypto';
import type { MediaKind } from '@prisma/client';
import { prisma } from '../../config/database';
import { env } from '../../config/env';
import { AppError } from '../../middlewares/error.middleware';
import { isValidMediaSignature, mediaUrlFor } from './media-url';
import { privateObjectStore, type ByteRange } from './object-storage';

interface StoreMediaInput {
  ownerId: string;
  kind: MediaKind;
  extension: string;
  mimeType: string;
  body: Buffer;
  requestOrigin: string;
}

const store = async ({
  ownerId,
  kind,
  extension,
  mimeType,
  body,
  requestOrigin,
}: StoreMediaInput): Promise<{ id: string; url: string }> => {
  const storageKey = `${ownerId}/${kind.toLowerCase()}/${randomUUID()}.${extension}`;
  await privateObjectStore.put(storageKey, body, mimeType);

  try {
    const media = await prisma.mediaObject.create({
      data: {
        ownerId,
        storageKey,
        kind,
        mimeType,
        sizeBytes: body.byteLength,
      },
      select: { id: true },
    });
    return { id: media.id, url: mediaUrlFor(media.id, requestOrigin) };
  } catch (err) {
    // Keep object storage and the metadata ledger consistent if the database
    // write fails (deleted owner, transient outage, unique collision, etc.).
    await privateObjectStore.delete(storageKey).catch(() => undefined);
    throw err;
  }
};

const getMetadataForRead = async (id: string) => {
  const media = await prisma.mediaObject.findUnique({
    where: { id },
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

const assertOwnedMediaUrl = async (
  ownerId: string,
  url: string,
  expectedKind: MediaKind,
): Promise<void> => {
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

  const owned = await prisma.mediaObject.findFirst({
    where: { id, ownerId, kind: expectedKind },
    select: { id: true },
  });
  if (!owned) {
    throw new AppError('VALIDATION_001', 'Media must be uploaded by the current user');
  }
};

export const mediaService = {
  store,
  getMetadataForRead,
  openForRead,
  deleteAllForUser,
  assertOwnedMediaUrl,
};
