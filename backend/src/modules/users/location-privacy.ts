import { prisma } from '../../config/database';

/**
 * Public map pins are deliberately quantised to a 0.05 degree grid. One
 * latitude step is roughly 5.5 km, which keeps the map useful at city-area
 * level without exposing a stranger's home, workplace, or exact movement.
 *
 * Exact coordinates are reserved for an explicit trust signal: both users
 * must have an ACCEPTED follow edge towards the other. Pending requests and a
 * one-way public follow never qualify.
 */
const APPROXIMATE_GRID_DEGREES = 0.05;

type Located = {
  latitude: number | null;
  longitude: number | null;
};

const quantise = (value: number): number => {
  const gridIndex = Math.round(value / APPROXIMATE_GRID_DEGREES);
  // The explicit decimal conversion removes floating-point artefacts such as
  // 48.85000000000001 from JSON while keeping every result on the same grid.
  const rounded = Number((gridIndex * APPROXIMATE_GRID_DEGREES).toFixed(2));
  // Avoid serialising -0, which is needlessly surprising to map clients.
  return Object.is(rounded, -0) ? 0 : rounded;
};

export const locationForViewer = <T extends Located>(location: T, exact: boolean): T => {
  if (exact || location.latitude === null || location.longitude === null) return location;
  return {
    ...location,
    latitude: quantise(location.latitude),
    longitude: quantise(location.longitude),
  };
};

/**
 * Resolve which peers have an accepted follow in both directions with the
 * given user. The lookup is batched so a REST roster or a socket fan-out costs
 * one indexed query rather than one query per map pin/device.
 */
export const getMutualFollowIds = async (
  userId: string,
  candidateIds: readonly string[],
): Promise<Set<string>> => {
  const candidates = [...new Set(candidateIds)].filter(id => id !== userId);
  if (candidates.length === 0) return new Set<string>();

  const edges = await prisma.follow.findMany({
    where: {
      status: 'ACCEPTED',
      OR: [
        { followerId: userId, followingId: { in: candidates } },
        { followerId: { in: candidates }, followingId: userId },
      ],
    },
    select: { followerId: true, followingId: true },
  });

  const outgoing = new Set<string>();
  const incoming = new Set<string>();
  for (const edge of edges) {
    if (edge.followerId === userId) outgoing.add(edge.followingId);
    if (edge.followingId === userId) incoming.add(edge.followerId);
  }

  return new Set(candidates.filter(id => outgoing.has(id) && incoming.has(id)));
};

export const locationsForViewer = async <T extends Located & { id: string }>(
  viewerId: string,
  locations: readonly T[],
): Promise<T[]> => {
  const exactIds = await getMutualFollowIds(
    viewerId,
    locations.map(location => location.id),
  );
  return locations.map(location => locationForViewer(location, exactIds.has(location.id)));
};
