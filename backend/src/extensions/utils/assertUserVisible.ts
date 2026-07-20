import { prisma } from '../../config/database';
import { AppError } from '../../middlewares/error.middleware';

/**
 * Extension routes that expose user-attached Redis data must obey the same
 * active-account and symmetric-block visibility rules as /api/users/:id.
 */
export const assertUserVisible = async (viewerId: string, targetUserId: string): Promise<void> => {
  const user = await prisma.user.findFirst({
    where: {
      id: targetUserId,
      deletedAt: null,
      ...(viewerId === targetUserId
        ? {}
        : {
            blocksCreated: { none: { blockedId: viewerId } },
            blocksReceived: { none: { blockerId: viewerId } },
          }),
    },
    select: { id: true },
  });
  if (!user) throw new AppError('USER_001');
};
