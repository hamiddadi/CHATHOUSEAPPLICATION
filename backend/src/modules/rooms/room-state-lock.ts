import type { Prisma, Room } from '@prisma/client';
import { prisma } from '../../config/database';

/**
 * Keep a Room row lock for the whole authorization + side-effect boundary.
 * Role changes, leave, kick, hand-off and room-state mutations use the same
 * Room-first lock order, so callers can safely authorize against `room` and
 * complete an idempotent Redis/DB effect before a concurrent revocation wins.
 *
 * This helper deliberately does not retry: a callback may touch Redis, and an
 * automatic transaction retry could duplicate a non-database side effect.
 */
export const withLockedRoomState = async <T>(
  roomId: string,
  work: (tx: Prisma.TransactionClient, room: Room | null) => Promise<T>,
): Promise<T> =>
  prisma.$transaction(
    async tx => {
      await tx.$queryRaw`SELECT set_config('lock_timeout', '5000ms', true)`;
      await tx.$queryRaw`SELECT "id" FROM "Room" WHERE "id" = ${roomId} FOR UPDATE`;
      const room = await tx.room.findUnique({ where: { id: roomId } });
      return work(tx, room);
    },
    { maxWait: 5_000, timeout: 15_000 },
  );
