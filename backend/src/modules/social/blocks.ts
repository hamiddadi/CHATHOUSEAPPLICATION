import { prisma } from '../../config/database';

/**
 * Returns the set of user ids that are "invisible" to the viewer:
 *   - users the viewer has blocked (blockerId = viewerId)
 *   - users who have blocked the viewer (blockedId = viewerId)
 *
 * Used to trim search results, explore feeds, and the hallway feed so
 * a block is a symmetric break — neither side sees the other anywhere
 * a discovery surface lists users.
 *
 * Cheap: two indexed reads + a Set union. Callers that need to filter
 * a large user query should fold the result into a `NOT IN` clause
 * rather than re-running this per row.
 */
export const getBlockedIdSet = async (viewerId: string): Promise<Set<string>> => {
  const rows = await prisma.block.findMany({
    where: {
      OR: [{ blockerId: viewerId }, { blockedId: viewerId }],
    },
    select: { blockerId: true, blockedId: true },
  });
  const out = new Set<string>();
  for (const r of rows) {
    out.add(r.blockerId === viewerId ? r.blockedId : r.blockerId);
  }
  return out;
};
