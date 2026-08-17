import type { Prisma } from '@prisma/client';
import { prisma } from '../../config/database';
import { AppError } from '../../middlewares/error.middleware';

/**
 * Single source of truth for room-metadata visibility.
 *
 * OPEN rooms are visible to authenticated users. SOCIAL rooms additionally
 * require an accepted follow of the host. CLOSED/private rooms require a
 * durable invitation/participation row. The host always keeps access, while a
 * block in either direction hides the room regardless of prior participation.
 */
export const roomMetadataAccessWhere = (viewerId: string): Prisma.RoomWhereInput => ({
  host: {
    deletedAt: null,
    blocksCreated: { none: { blockedId: viewerId } },
    blocksReceived: { none: { blockerId: viewerId } },
  },
  bans: {
    none: {
      userId: viewerId,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
  },
  OR: [
    { hostId: viewerId },
    {
      AND: [
        { OR: [{ isPrivate: true }, { roomType: 'CLOSED' }] },
        { participants: { some: { userId: viewerId } } },
      ],
    },
    { isPrivate: false, roomType: 'OPEN' },
    {
      isPrivate: false,
      roomType: 'SOCIAL',
      OR: [
        // Someone currently inside does not disappear mid-session if a follow
        // edge is removed concurrently. Once they leave, current ACCEPTED
        // follow status becomes authoritative again.
        { participants: { some: { userId: viewerId, leftAt: null } } },
        {
          host: {
            followers: {
              some: {
                followerId: viewerId,
                status: 'ACCEPTED',
                follower: { deletedAt: null },
              },
            },
          },
        },
      ],
    },
  ],
});

/**
 * Discovery surfaces never enumerate CLOSED/private rooms, even for invitees.
 * They may expose SOCIAL rooms only to the host, an admitted participant, or
 * an accepted follower of the host.
 */
export const discoverableRoomWhere = (viewerId: string): Prisma.RoomWhereInput => ({
  AND: [
    roomMetadataAccessWhere(viewerId),
    {
      isPrivate: false,
      roomType: { not: 'CLOSED' },
    },
  ],
});

export const assertRoomMetadataAccess = async (roomId: string, viewerId: string): Promise<void> => {
  const room = await prisma.room.findFirst({
    where: {
      AND: [{ id: roomId }, roomMetadataAccessWhere(viewerId)],
    },
    select: { id: true },
  });
  if (!room) throw new AppError('ROOM_001');
};
