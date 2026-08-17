import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../config/database';
import { AppError } from '../middlewares/error.middleware';

const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
const KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;

const canonicalize = (value: unknown): unknown => {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, nested]) => [key, canonicalize(nested)]),
    );
  }
  return value;
};

const requestHashFor = (payload: unknown): string =>
  createHash('sha256')
    .update(JSON.stringify(canonicalize(payload)))
    .digest('hex');

const normalizeKey = (raw: string | undefined): string | undefined => {
  if (raw === undefined) return undefined;
  const key = raw.trim();
  if (!KEY_PATTERN.test(key)) throw new AppError('IDEMPOTENCY_002');
  return key;
};

const assertSameRequest = (
  row: { requestHash: string; resourceId: string | null },
  requestHash: string,
): string => {
  if (row.requestHash !== requestHash) throw new AppError('IDEMPOTENCY_001');
  if (!row.resourceId) {
    // A null resource is only visible inside the transaction that owns the
    // claim; committed rows must always point at the completed result.
    throw new AppError('SERVER_001', 'Incomplete idempotency record');
  }
  return row.resourceId;
};

interface IdempotentCreateOptions {
  userId: string;
  scope: string;
  key?: string;
  payload: unknown;
  create: (tx: Prisma.TransactionClient) => Promise<string>;
}

/**
 * Run a resource creation and its idempotency claim in one transaction.
 * Without a header it still gives callers atomic multi-row creation. With a
 * header, concurrent/retried requests resolve to the first committed resource.
 */
export const runIdempotentCreate = async ({
  userId,
  scope,
  key: rawKey,
  payload,
  create,
}: IdempotentCreateOptions): Promise<{ resourceId: string; replayed: boolean }> => {
  const key = normalizeKey(rawKey);
  if (!key) {
    const resourceId = await prisma.$transaction(create, { maxWait: 5_000, timeout: 10_000 });
    return { resourceId, replayed: false };
  }

  const requestHash = requestHashFor(payload);
  const execute = () =>
    prisma.$transaction(
      async tx => {
        const existing = await tx.idempotencyKey.findUnique({
          where: { userId_scope_key: { userId, scope, key } },
          select: { id: true, requestHash: true, resourceId: true, expiresAt: true },
        });
        if (existing && existing.expiresAt > new Date()) {
          return { resourceId: assertSameRequest(existing, requestHash), replayed: true };
        }
        if (existing) {
          // Two requests can both observe the same expired row. Conditional
          // deletion lets one remove it while the other proceeds to the
          // unique-claim race below; `delete()` would make the loser throw
          // P2025 before the normal P2002 replay path can resolve the winner.
          await tx.idempotencyKey.deleteMany({ where: { id: existing.id } });
        }

        const claim = await tx.idempotencyKey.create({
          data: {
            userId,
            scope,
            key,
            requestHash,
            expiresAt: new Date(Date.now() + IDEMPOTENCY_TTL_MS),
          },
          select: { id: true },
        });
        const resourceId = await create(tx);
        await tx.idempotencyKey.update({
          where: { id: claim.id },
          data: { resourceId },
        });
        return { resourceId, replayed: false };
      },
      { maxWait: 5_000, timeout: 10_000 },
    );

  try {
    return await execute();
  } catch (err) {
    // A concurrent request can win the unique key claim. PostgreSQL waits for
    // that transaction, then Prisma raises P2002; resolve the committed winner.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const winner = await prisma.idempotencyKey.findUnique({
        where: { userId_scope_key: { userId, scope, key } },
        select: { requestHash: true, resourceId: true, expiresAt: true },
      });
      if (winner && winner.expiresAt > new Date()) {
        return { resourceId: assertSameRequest(winner, requestHash), replayed: true };
      }
    }
    throw err;
  }
};
