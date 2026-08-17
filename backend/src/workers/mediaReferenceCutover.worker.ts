import { createHmac, timingSafeEqual } from 'node:crypto';
import { MediaKind, PrismaClient } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';

export const MEDIA_REFERENCE_CUTOVER_KEY = 'private-media-reference-v1';
const PAGE_SIZE = 250;

const workerEnvSchema = z
  .object({
    DATABASE_URL: z.string().min(1),
    PUBLIC_URL: z.string().url(),
    MEDIA_URL_SIGNING_SECRET: z.string().min(32),
  })
  .transform(value => {
    const publicUrl = new URL(value.PUBLIC_URL);
    if (publicUrl.protocol !== 'https:' || publicUrl.pathname !== '/' || publicUrl.search) {
      throw new Error('PUBLIC_URL must be an origin-only https URL');
    }
    return {
      databaseUrl: value.DATABASE_URL,
      publicOrigin: publicUrl.origin,
      signingSecret: value.MEDIA_URL_SIGNING_SECRET,
    };
  });

export type MediaReferenceCutoverConfig = z.infer<typeof workerEnvSchema>;

export interface MediaReferenceCutoverResult {
  scanned: number;
  migrated: number;
  neutralizedUnavailable: number;
  externalPreserved: number;
  verifiedAt: string;
}

interface LegacyReference {
  mediaId: string;
  replacement: string;
}

interface PlannedUpdate extends LegacyReference {
  source: string;
  expectedKind: MediaKind;
  expectedOwnerIds?: ReadonlySet<string>;
  linkedMediaId?: string | null;
  apply: () => Promise<number>;
  neutralizeUnavailable?: () => Promise<number>;
}

type CutoverTx = Prisma.TransactionClient;

const hmac = (secret: string, value: string): string =>
  createHmac('sha256', secret).update(value).digest('base64url');

const signatureMatches = (expected: string, candidate: string): boolean => {
  if (!/^[A-Za-z0-9_-]{43}$/.test(candidate)) return false;
  const expectedBytes = Buffer.from(expected);
  const candidateBytes = Buffer.from(candidate);
  return (
    expectedBytes.byteLength === candidateBytes.byteLength &&
    timingSafeEqual(expectedBytes, candidateBytes)
  );
};

/**
 * Convert only an authentic capability issued by this API. URLs on another
 * origin are deliberately preserved; arbitrary text never reaches this
 * migrator because callers enumerate the known relational media columns.
 */
export const legacyReferenceForCutover = (
  value: string,
  config: Pick<MediaReferenceCutoverConfig, 'publicOrigin' | 'signingSecret'>,
): LegacyReference | null => {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('stored media candidate is not a valid URL');
  }

  if (parsed.origin !== config.publicOrigin) return null;
  if (parsed.search || parsed.hash) {
    throw new Error('internal media URL must not contain query or fragment data');
  }

  const parts = parsed.pathname.split('/').filter(Boolean);
  if (parts[0] === 'media-ref' && parts.length === 3) {
    const [, mediaId, signature] = parts;
    if (
      !mediaId ||
      !signature ||
      !signatureMatches(hmac(config.signingSecret, `media:ref:v1:${mediaId}`), signature)
    ) {
      throw new Error('stored internal media signature is invalid');
    }
    return { mediaId, replacement: value };
  }

  if (parts[0] !== 'media') {
    throw new Error('unexpected internal media path');
  }

  let mediaId: string | undefined;
  let valid = false;
  if (parts.length === 3) {
    const [, id, signature] = parts;
    mediaId = id;
    valid =
      !!id &&
      !!signature &&
      signatureMatches(hmac(config.signingSecret, `media:v1:${id}`), signature);
  } else if (parts.length === 4) {
    const [, id, expiresAt, signature] = parts;
    mediaId = id;
    valid =
      !!id &&
      !!expiresAt &&
      /^\d{10}$/.test(expiresAt) &&
      !!signature &&
      signatureMatches(hmac(config.signingSecret, `media:v2:${id}:${expiresAt}`), signature);
  }

  if (!valid || !mediaId) throw new Error('stored internal media signature is invalid');
  const referenceSignature = hmac(config.signingSecret, `media:ref:v1:${mediaId}`);
  return {
    mediaId,
    replacement: `${config.publicOrigin}/media-ref/${mediaId}/${referenceSignature}`,
  };
};

const candidate = (
  value: string | null,
  source: string,
  expectedKind: MediaKind,
  config: MediaReferenceCutoverConfig,
  result: MediaReferenceCutoverResult,
  apply: (replacement: string, mediaId: string) => Promise<number>,
  options: {
    expectedOwnerIds?: ReadonlySet<string>;
    linkedMediaId?: string | null;
    allowReferenceBackfill?: boolean;
    neutralizeUnavailable?: () => Promise<number>;
  } = {},
): PlannedUpdate | null => {
  // A row can be selected because another media column still contains the
  // legacy marker. Do not re-parse an already migrated `/media-ref/` sibling
  // (or any other non-candidate value) on an idempotent rerun.
  if (
    !value?.includes('/media/') &&
    !(options.allowReferenceBackfill && value?.includes('/media-ref/'))
  ) {
    return null;
  }
  result.scanned += 1;
  let parsed: LegacyReference | null;
  try {
    parsed = legacyReferenceForCutover(value, config);
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'invalid media reference';
    throw new Error(`${source}: ${reason}`);
  }
  if (!parsed) {
    result.externalPreserved += 1;
    return null;
  }
  return {
    ...parsed,
    source,
    expectedKind,
    ...options,
    apply: () => apply(parsed.replacement, parsed.mediaId),
  };
};

const applyPage = async (
  tx: CutoverTx,
  updates: PlannedUpdate[],
  result: MediaReferenceCutoverResult,
): Promise<void> => {
  if (updates.length === 0) return;
  const media = await tx.mediaObject.findMany({
    where: { id: { in: [...new Set(updates.map(update => update.mediaId))] } },
    select: {
      id: true,
      ownerId: true,
      kind: true,
      uploadCompletedAt: true,
      deletionClaimedAt: true,
    },
  });
  const byId = new Map(media.map(row => [row.id, row]));
  const unavailable = new Set<PlannedUpdate>();

  for (const update of updates) {
    const object = byId.get(update.mediaId);
    if (
      update.linkedMediaId !== undefined &&
      update.linkedMediaId !== null &&
      update.linkedMediaId !== update.mediaId
    ) {
      throw new Error(`${update.source}: relational media link does not match the signed URL`);
    }
    if (
      !object ||
      object.kind !== update.expectedKind ||
      object.uploadCompletedAt === null ||
      object.deletionClaimedAt !== null
    ) {
      if (update.neutralizeUnavailable) {
        unavailable.add(update);
        continue;
      }
      throw new Error(`${update.source}: linked media object is unavailable or has the wrong type`);
    }
    if (update.expectedOwnerIds && !update.expectedOwnerIds.has(object.ownerId)) {
      throw new Error(`${update.source}: linked media object owner is not authorized`);
    }
  }

  for (const update of updates) {
    const changed =
      unavailable.has(update) && update.neutralizeUnavailable
        ? await update.neutralizeUnavailable()
        : await update.apply();
    if (changed !== 1) {
      throw new Error(`${update.source}: row changed while the maintenance cutover was running`);
    }
    if (unavailable.has(update)) result.neutralizedUnavailable += 1;
    else result.migrated += 1;
  }
};

const migrateUsers = async (
  tx: CutoverTx,
  config: MediaReferenceCutoverConfig,
  result: MediaReferenceCutoverResult,
): Promise<void> => {
  let after: string | undefined;
  for (;;) {
    const rows = await tx.user.findMany({
      where: {
        id: after ? { gt: after } : undefined,
        OR: [{ avatarUrl: { contains: '/media/' } }, { avatarThumb: { contains: '/media/' } }],
      },
      orderBy: { id: 'asc' },
      take: PAGE_SIZE,
      select: { id: true, avatarUrl: true, avatarThumb: true },
    });
    if (rows.length === 0) return;
    const updates: PlannedUpdate[] = [];
    for (const row of rows) {
      const owners = new Set([row.id]);
      const avatar = candidate(
        row.avatarUrl,
        `User(${row.id}).avatarUrl`,
        MediaKind.AVATAR,
        config,
        result,
        async replacement =>
          (
            await tx.user.updateMany({
              where: { id: row.id, avatarUrl: row.avatarUrl },
              data: { avatarUrl: replacement },
            })
          ).count,
        { expectedOwnerIds: owners },
      );
      if (avatar) updates.push(avatar);
      const thumb = candidate(
        row.avatarThumb,
        `User(${row.id}).avatarThumb`,
        MediaKind.AVATAR,
        config,
        result,
        async replacement =>
          (
            await tx.user.updateMany({
              where: { id: row.id, avatarThumb: row.avatarThumb },
              data: { avatarThumb: replacement },
            })
          ).count,
        { expectedOwnerIds: owners },
      );
      if (thumb) updates.push(thumb);
    }
    await applyPage(tx, updates, result);
    const last = rows.at(-1);
    if (!last) return;
    after = last.id;
  }
};

const migrateClubs = async (
  tx: CutoverTx,
  config: MediaReferenceCutoverConfig,
  result: MediaReferenceCutoverResult,
): Promise<void> => {
  let after: string | undefined;
  for (;;) {
    const rows = await tx.club.findMany({
      where: {
        id: after ? { gt: after } : undefined,
        OR: [
          { iconUrl: { contains: '/media/' } },
          { iconUrl: { contains: '/media-ref/' }, iconMediaObjectId: null },
        ],
      },
      orderBy: { id: 'asc' },
      take: PAGE_SIZE,
      select: {
        id: true,
        iconUrl: true,
        iconMediaObjectId: true,
      },
    });
    if (rows.length === 0) return;
    const updates: PlannedUpdate[] = [];
    for (const row of rows) {
      const planned = candidate(
        row.iconUrl,
        `Club(${row.id}).iconUrl`,
        MediaKind.AVATAR,
        config,
        result,
        async (replacement, mediaId) =>
          (
            await tx.club.updateMany({
              where: {
                id: row.id,
                iconUrl: row.iconUrl,
                iconMediaObjectId: row.iconMediaObjectId,
              },
              data: { iconUrl: replacement, iconMediaObjectId: mediaId },
            })
          ).count,
        {
          linkedMediaId: row.iconMediaObjectId,
          allowReferenceBackfill: true,
          neutralizeUnavailable: async () =>
            (
              await tx.club.updateMany({
                where: {
                  id: row.id,
                  iconUrl: row.iconUrl,
                  iconMediaObjectId: row.iconMediaObjectId,
                },
                data: { iconUrl: null, iconMediaObjectId: null },
              })
            ).count,
        },
      );
      if (planned) updates.push(planned);
    }
    await applyPage(tx, updates, result);
    const last = rows.at(-1);
    if (!last) return;
    after = last.id;
  }
};

const migrateClubMetadata = async (
  tx: CutoverTx,
  config: MediaReferenceCutoverConfig,
  result: MediaReferenceCutoverResult,
): Promise<void> => {
  let after: string | undefined;
  for (;;) {
    const rows = await tx.clubMetadata.findMany({
      where: {
        clubId: after ? { gt: after } : undefined,
        OR: [
          { coverUrl: { contains: '/media/' } },
          { coverUrl: { contains: '/media-ref/' }, coverMediaObjectId: null },
        ],
      },
      orderBy: { clubId: 'asc' },
      take: PAGE_SIZE,
      select: {
        clubId: true,
        coverUrl: true,
        coverMediaObjectId: true,
      },
    });
    if (rows.length === 0) return;
    const updates: PlannedUpdate[] = [];
    for (const row of rows) {
      const planned = candidate(
        row.coverUrl,
        `ClubMetadata(${row.clubId}).coverUrl`,
        MediaKind.AVATAR,
        config,
        result,
        async (replacement, mediaId) =>
          (
            await tx.clubMetadata.updateMany({
              where: {
                clubId: row.clubId,
                coverUrl: row.coverUrl,
                coverMediaObjectId: row.coverMediaObjectId,
              },
              data: { coverUrl: replacement, coverMediaObjectId: mediaId },
            })
          ).count,
        {
          linkedMediaId: row.coverMediaObjectId,
          allowReferenceBackfill: true,
          neutralizeUnavailable: async () =>
            (
              await tx.clubMetadata.updateMany({
                where: {
                  clubId: row.clubId,
                  coverUrl: row.coverUrl,
                  coverMediaObjectId: row.coverMediaObjectId,
                },
                data: { coverUrl: null, coverMediaObjectId: null },
              })
            ).count,
        },
      );
      if (planned) updates.push(planned);
    }
    await applyPage(tx, updates, result);
    const last = rows.at(-1);
    if (!last) return;
    after = last.clubId;
  }
};

const migrateDirectMessages = async (
  tx: CutoverTx,
  config: MediaReferenceCutoverConfig,
  result: MediaReferenceCutoverResult,
): Promise<void> => {
  let after: string | undefined;
  for (;;) {
    const rows = await tx.message.findMany({
      where: { id: after ? { gt: after } : undefined, audioUrl: { contains: '/media/' } },
      orderBy: { id: 'asc' },
      take: PAGE_SIZE,
      select: { id: true, senderId: true, audioUrl: true, mediaObjectId: true },
    });
    if (rows.length === 0) return;
    const updates: PlannedUpdate[] = [];
    for (const row of rows) {
      const planned = candidate(
        row.audioUrl,
        `Message(${row.id}).audioUrl`,
        MediaKind.VOICE,
        config,
        result,
        async replacement =>
          (
            await tx.message.updateMany({
              where: {
                id: row.id,
                audioUrl: row.audioUrl,
                mediaObjectId: row.mediaObjectId,
              },
              data: { audioUrl: replacement },
            })
          ).count,
        { expectedOwnerIds: new Set([row.senderId]), linkedMediaId: row.mediaObjectId },
      );
      if (planned) updates.push(planned);
    }
    await applyPage(tx, updates, result);
    const last = rows.at(-1);
    if (!last) return;
    after = last.id;
  }
};

const migrateGroupMessages = async (
  tx: CutoverTx,
  config: MediaReferenceCutoverConfig,
  result: MediaReferenceCutoverResult,
): Promise<void> => {
  let after: string | undefined;
  for (;;) {
    const rows = await tx.groupMessage.findMany({
      where: { id: after ? { gt: after } : undefined, audioUrl: { contains: '/media/' } },
      orderBy: { id: 'asc' },
      take: PAGE_SIZE,
      select: { id: true, senderId: true, audioUrl: true, mediaObjectId: true },
    });
    if (rows.length === 0) return;
    const updates: PlannedUpdate[] = [];
    for (const row of rows) {
      const planned = candidate(
        row.audioUrl,
        `GroupMessage(${row.id}).audioUrl`,
        MediaKind.VOICE,
        config,
        result,
        async replacement =>
          (
            await tx.groupMessage.updateMany({
              where: {
                id: row.id,
                audioUrl: row.audioUrl,
                mediaObjectId: row.mediaObjectId,
              },
              data: { audioUrl: replacement },
            })
          ).count,
        { expectedOwnerIds: new Set([row.senderId]), linkedMediaId: row.mediaObjectId },
      );
      if (planned) updates.push(planned);
    }
    await applyPage(tx, updates, result);
    const last = rows.at(-1);
    if (!last) return;
    after = last.id;
  }
};

const migrateReports = async (
  tx: CutoverTx,
  config: MediaReferenceCutoverConfig,
  result: MediaReferenceCutoverResult,
): Promise<void> => {
  let after: string | undefined;
  for (;;) {
    const rows = await tx.report.findMany({
      where: {
        id: after ? { gt: after } : undefined,
        OR: [
          { contentAudioUrl: { contains: '/media/' } },
          { contentAudioUrl: { contains: '/media-ref/' }, contentMediaObjectId: null },
        ],
      },
      orderBy: { id: 'asc' },
      take: PAGE_SIZE,
      select: {
        id: true,
        contentAuthorId: true,
        contentAudioUrl: true,
        contentMediaObjectId: true,
      },
    });
    if (rows.length === 0) return;
    const updates: PlannedUpdate[] = [];
    for (const row of rows) {
      const owners = row.contentAuthorId ? new Set([row.contentAuthorId]) : undefined;
      const planned = candidate(
        row.contentAudioUrl,
        `Report(${row.id}).contentAudioUrl`,
        MediaKind.VOICE,
        config,
        result,
        async (replacement, mediaId) =>
          (
            await tx.report.updateMany({
              where: {
                id: row.id,
                contentAudioUrl: row.contentAudioUrl,
                contentMediaObjectId: row.contentMediaObjectId,
              },
              data: { contentAudioUrl: replacement, contentMediaObjectId: mediaId },
            })
          ).count,
        {
          expectedOwnerIds: owners,
          linkedMediaId: row.contentMediaObjectId,
          allowReferenceBackfill: true,
          neutralizeUnavailable: async () =>
            (
              await tx.report.updateMany({
                where: {
                  id: row.id,
                  contentAudioUrl: row.contentAudioUrl,
                  contentMediaObjectId: row.contentMediaObjectId,
                },
                data: { contentAudioUrl: null, contentMediaObjectId: null },
              })
            ).count,
        },
      );
      if (planned) updates.push(planned);
    }
    await applyPage(tx, updates, result);
    const last = rows.at(-1);
    if (!last) return;
    after = last.id;
  }
};

export const migrateLegacyMediaReferences = async (
  prisma: PrismaClient,
  config: MediaReferenceCutoverConfig,
): Promise<MediaReferenceCutoverResult> =>
  prisma.$transaction(
    async tx => {
      // Serialize every invocation, including manual/operator runs outside the
      // deployment workflow. The deploy cleanup probe uses the same two-key
      // advisory lock to prove that an interrupted transaction has released
      // all writes before any API writer can be restarted.
      // `$executeRaw` deliberately discards the SELECT result: PostgreSQL's
      // advisory-lock function returns the pseudo-type `void`, which Prisma
      // cannot deserialize through `$queryRaw`.
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(
          hashtext('chathouse'),
          hashtext(${MEDIA_REFERENCE_CUTOVER_KEY})
        )
      `;
      const result: MediaReferenceCutoverResult = {
        scanned: 0,
        migrated: 0,
        neutralizedUnavailable: 0,
        externalPreserved: 0,
        verifiedAt: '',
      };
      await migrateUsers(tx, config, result);
      await migrateClubs(tx, config, result);
      await migrateClubMetadata(tx, config, result);
      await migrateDirectMessages(tx, config, result);
      await migrateGroupMessages(tx, config, result);
      await migrateReports(tx, config, result);

      const completedAt = new Date();
      result.verifiedAt = completedAt.toISOString();
      await tx.deploymentCutover.upsert({
        where: { key: MEDIA_REFERENCE_CUTOVER_KEY },
        create: {
          key: MEDIA_REFERENCE_CUTOVER_KEY,
          details: result as unknown as Prisma.InputJsonValue,
        },
        update: {
          completedAt,
          details: result as unknown as Prisma.InputJsonValue,
        },
      });
      return result;
    },
    { maxWait: 30_000, timeout: 30 * 60 * 1000 },
  );

const main = async (): Promise<void> => {
  const config = workerEnvSchema.parse(process.env);
  const prisma = new PrismaClient({ datasources: { db: { url: config.databaseUrl } } });
  try {
    const result = await migrateLegacyMediaReferences(prisma, config);
    // eslint-disable-next-line no-console -- standalone one-shot emits JSON to container logs
    console.log(JSON.stringify({ level: 'info', event: 'media_reference_cutover', ...result }));
  } finally {
    await prisma.$disconnect();
  }
};

if (require.main === module) {
  void main().catch(error => {
    console.error(
      JSON.stringify({
        level: 'error',
        event: 'media_reference_cutover_failed',
        reason: error instanceof Error ? error.message : 'unknown failure',
      }),
    );
    process.exitCode = 1;
  });
}
