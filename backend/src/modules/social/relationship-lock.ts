import { Prisma } from '@prisma/client';

/**
 * Follow, block and group-admission mutations all lock the same User rows in
 * lexical order. This gives those otherwise independent tables one shared
 * serialization boundary: after a block commits, a concurrent follow/group
 * write cannot recreate the relationship from a stale pre-check.
 */
export const lockUserRows = async (
  tx: Prisma.TransactionClient,
  userIds: string[],
): Promise<string[]> => {
  const ids = [...new Set(userIds)].sort();
  if (ids.length === 0) return [];

  const rows = await tx.$queryRaw<{ id: string }[]>(
    Prisma.sql`
      SELECT id
      FROM "User"
      WHERE id IN (${Prisma.join(ids)})
      ORDER BY id
      FOR UPDATE
    `,
  );
  return rows.map(row => row.id);
};

export const lockRelationshipUsers = async (
  tx: Prisma.TransactionClient,
  firstUserId: string,
  secondUserId: string,
): Promise<string[]> => lockUserRows(tx, [firstUserId, secondUserId]);

export const hasBlockBetween = async (
  tx: Prisma.TransactionClient,
  firstUserId: string,
  secondUserId: string,
): Promise<boolean> => {
  const block = await tx.block.findFirst({
    where: {
      OR: [
        { blockerId: firstUserId, blockedId: secondUserId },
        { blockerId: secondUserId, blockedId: firstUserId },
      ],
    },
    select: { id: true },
  });
  return block !== null;
};
