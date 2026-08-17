import type { Prisma } from '@prisma/client';
import { prisma, runWriteWithRetry } from '../../config/database';

type TransactionClient = Prisma.TransactionClient;

const legacyImportsInFlight = new Map<string, Promise<void>>();

const singleFlightImport = (key: string, run: () => Promise<void>): Promise<void> => {
  const current = legacyImportsInFlight.get(key);
  if (current) return current;
  const started = run().finally(() => {
    if (legacyImportsInFlight.get(key) === started) legacyImportsInFlight.delete(key);
  });
  legacyImportsInFlight.set(key, started);
  return started;
};

/**
 * Import one user-scoped legacy Redis namespace exactly once.
 *
 * Every caller (reads and writes) passes through this gate during the cut-over.
 * Locking the owning row serializes concurrent first access, while the durable
 * marker distinguishes an intentionally empty legacy value from an import that
 * has not run yet.
 */
export const ensureUserExtensionImported = async <T>(
  namespace: string,
  userId: string,
  loadLegacy: () => Promise<T>,
  importLegacy: (tx: TransactionClient, legacy: T) => Promise<void>,
): Promise<void> => {
  const done = await prisma.userExtensionImport.findUnique({
    where: { userId_namespace: { userId, namespace } },
    select: { userId: true },
  });
  if (done) return;

  return singleFlightImport(`user:${namespace}:${userId}`, async () => {
    // Re-check after joining the process-local single flight. Database row
    // locking below is still the cross-process authority.
    const importedBeforeLoad = await prisma.userExtensionImport.findUnique({
      where: { userId_namespace: { userId, namespace } },
      select: { userId: true },
    });
    if (importedBeforeLoad) return;

    // Redis I/O deliberately happens before the database transaction so an
    // unavailable legacy store cannot hold a PostgreSQL row lock.
    const legacy = await loadLegacy();
    await runWriteWithRetry(() =>
      prisma.$transaction(
        async tx => {
          const owner = await tx.$queryRaw<{ id: string }[]>`
            SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
          if (owner.length === 0) return;

          const imported = await tx.userExtensionImport.findUnique({
            where: { userId_namespace: { userId, namespace } },
            select: { userId: true },
          });
          if (imported) return;

          await importLegacy(tx, legacy);
          await tx.userExtensionImport.create({ data: { userId, namespace } });
        },
        { maxWait: 10_000, timeout: 15_000 },
      ),
    );
  });
};

/** Club-scoped counterpart of {@link ensureUserExtensionImported}. */
export const ensureClubExtensionImported = async <T>(
  namespace: string,
  clubId: string,
  loadLegacy: () => Promise<T>,
  importLegacy: (tx: TransactionClient, legacy: T) => Promise<void>,
): Promise<void> => {
  const done = await prisma.clubExtensionImport.findUnique({
    where: { clubId_namespace: { clubId, namespace } },
    select: { clubId: true },
  });
  if (done) return;

  return singleFlightImport(`club:${namespace}:${clubId}`, async () => {
    const importedBeforeLoad = await prisma.clubExtensionImport.findUnique({
      where: { clubId_namespace: { clubId, namespace } },
      select: { clubId: true },
    });
    if (importedBeforeLoad) return;

    const legacy = await loadLegacy();
    await runWriteWithRetry(() =>
      prisma.$transaction(
        async tx => {
          const owner = await tx.$queryRaw<{ id: string }[]>`
            SELECT "id" FROM "Club" WHERE "id" = ${clubId} FOR UPDATE`;
          if (owner.length === 0) return;

          const imported = await tx.clubExtensionImport.findUnique({
            where: { clubId_namespace: { clubId, namespace } },
            select: { clubId: true },
          });
          if (imported) return;

          await importLegacy(tx, legacy);
          await tx.clubExtensionImport.create({ data: { clubId, namespace } });
        },
        { maxWait: 10_000, timeout: 15_000 },
      ),
    );
  });
};
