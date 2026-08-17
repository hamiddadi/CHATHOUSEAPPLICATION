import type { Prisma } from '@prisma/client';
import { prisma } from '../../config/database';
import { AppError } from '../../middlewares/error.middleware';
import { hasBlockBetween, lockRelationshipUsers } from '../social/relationship-lock';

/**
 * Compute whether `senderId` may start a direct message with each recipient.
 *
 * The result deliberately exposes only an actionable boolean. The recipient's
 * exact privacy setting and block state stay private. Keeping this policy in
 * one place also prevents the compose picker and the send boundary from
 * drifting apart again.
 */
export const directMessageEligibility = async (
  senderId: string,
  recipientIds: readonly string[],
): Promise<Map<string, boolean>> => {
  const ids = [...new Set(recipientIds.filter(id => id.length > 0 && id !== senderId))];
  if (ids.length === 0) return new Map();

  const [recipients, followRows, blockRows] = await Promise.all([
    prisma.user.findMany({
      where: { id: { in: ids }, deletedAt: null },
      select: { id: true, dmPrivacy: true },
    }),
    prisma.follow.findMany({
      where: {
        status: 'ACCEPTED',
        OR: [
          { followerId: senderId, followingId: { in: ids } },
          { followerId: { in: ids }, followingId: senderId },
        ],
      },
      select: { followerId: true, followingId: true },
    }),
    prisma.block.findMany({
      where: {
        OR: [
          { blockerId: senderId, blockedId: { in: ids } },
          { blockerId: { in: ids }, blockedId: senderId },
        ],
      },
      select: { blockerId: true, blockedId: true },
    }),
  ]);

  const senderFollows = new Set(
    followRows.filter(row => row.followerId === senderId).map(row => row.followingId),
  );
  const followsSender = new Set(
    followRows.filter(row => row.followingId === senderId).map(row => row.followerId),
  );
  const blocked = new Set(
    blockRows.map(row => (row.blockerId === senderId ? row.blockedId : row.blockerId)),
  );

  return new Map(
    recipients.map(recipient => {
      let allowed = false;
      if (!blocked.has(recipient.id)) {
        switch (recipient.dmPrivacy) {
          case 'everyone':
            allowed = true;
            break;
          case 'followers':
            allowed = senderFollows.has(recipient.id);
            break;
          case 'mutual':
            allowed = senderFollows.has(recipient.id) && followsSender.has(recipient.id);
            break;
          case 'nobody':
            allowed = false;
            break;
        }
      }
      return [recipient.id, allowed] as const;
    }),
  );
};

/**
 * Authoritative send-time guard. The UI eligibility flag is only a proactive
 * hint: this check remains mandatory because follows/privacy can change while a
 * compose screen is open.
 */
export const assertCanDirectMessage = async (
  senderId: string,
  recipientId: string,
): Promise<void> => {
  const eligibility = await directMessageEligibility(senderId, [recipientId]);
  if (!eligibility.has(recipientId)) throw new AppError('USER_001');
  if (!eligibility.get(recipientId)) throw new AppError('CHAT_004');
};

/**
 * Authoritative, linearizable DM guard used by message insertion. Follow,
 * block and privacy mutations all write one of these two User rows; taking the
 * same ordered locks makes the authorization decision and Message insert one
 * atomic point in that order. A preflight policy read alone cannot provide
 * this guarantee because its relationship may disappear before the insert.
 */
export const assertCanDirectMessageWithinTransaction = async (
  tx: Prisma.TransactionClient,
  senderId: string,
  recipientId: string,
): Promise<void> => {
  const lockedIds = await lockRelationshipUsers(tx, senderId, recipientId);
  if (lockedIds.length !== 2) throw new AppError('USER_001');

  const users = await tx.user.findMany({
    where: { id: { in: [senderId, recipientId] }, deletedAt: null },
    select: { id: true, dmPrivacy: true },
  });
  if (users.length !== 2) throw new AppError('USER_001');
  const recipient = users.find(user => user.id === recipientId);
  if (!recipient) throw new AppError('USER_001');

  if (await hasBlockBetween(tx, senderId, recipientId)) {
    throw new AppError('CHAT_004');
  }

  if (recipient.dmPrivacy === 'everyone') return;
  if (recipient.dmPrivacy === 'nobody') throw new AppError('CHAT_004');

  const accepted = await tx.follow.findMany({
    where: {
      status: 'ACCEPTED',
      OR: [
        { followerId: senderId, followingId: recipientId },
        { followerId: recipientId, followingId: senderId },
      ],
    },
    select: { followerId: true, followingId: true },
  });
  const senderFollowsRecipient = accepted.some(
    follow => follow.followerId === senderId && follow.followingId === recipientId,
  );
  const recipientFollowsSender = accepted.some(
    follow => follow.followerId === recipientId && follow.followingId === senderId,
  );
  const allowed =
    recipient.dmPrivacy === 'followers'
      ? senderFollowsRecipient
      : senderFollowsRecipient && recipientFollowsSender;
  if (!allowed) throw new AppError('CHAT_004');
};
