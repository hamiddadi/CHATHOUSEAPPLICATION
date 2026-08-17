import { randomUUID } from 'node:crypto';

/* eslint-disable @typescript-eslint/no-require-imports */
const { prisma } = require('../src/config/database') as typeof import('../src/config/database');
const { groupsService } =
  require('../src/modules/groups/groups.service') as typeof import('../src/modules/groups/groups.service');
/* eslint-enable @typescript-eslint/no-require-imports */

describe('Group member limit', () => {
  const ownerId: string = randomUUID();
  const initialOtherMemberIds: string[] = Array.from({ length: 48 }, () => randomUUID());
  const firstCandidateId: string = randomUUID();
  const secondCandidateId: string = randomUUID();
  const userIds = [ownerId, ...initialOtherMemberIds, firstCandidateId, secondCandidateId];
  const initialMemberIds = [ownerId, ...initialOtherMemberIds];
  let conversationId: string | undefined;

  beforeAll(async () => {
    await prisma.user.createMany({
      data: userIds.map(id => ({ id })),
    });
    const conversation = await prisma.conversation.create({
      data: {
        ownerId,
        title: 'Concurrent member limit test',
        members: {
          create: initialMemberIds.map(userId => ({ userId })),
        },
      },
      select: { id: true },
    });
    conversationId = conversation.id;
    await prisma.follow.createMany({
      data: [firstCandidateId, secondCandidateId].map(followingId => ({
        followerId: ownerId,
        followingId,
        status: 'ACCEPTED' as const,
      })),
    });
  });

  afterAll(async () => {
    if (conversationId) {
      await prisma.conversation.delete({ where: { id: conversationId } }).catch(() => undefined);
    }
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  it('serializes two admissions at 49 members and commits exactly one', async () => {
    if (!conversationId) throw new Error('Test conversation was not created');

    const outcomes = await Promise.allSettled([
      groupsService.addMembers(ownerId, conversationId, { userIds: [firstCandidateId] }),
      groupsService.addMembers(ownerId, conversationId, { userIds: [secondCandidateId] }),
    ]);

    expect(outcomes.filter(outcome => outcome.status === 'fulfilled')).toHaveLength(1);
    const rejected = outcomes.filter(
      (outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected',
    );
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toMatchObject({ code: 'GROUP_008', status: 400 });

    const members = await prisma.conversationMember.findMany({
      where: { conversationId },
      select: { userId: true },
    });
    expect(members).toHaveLength(50);
    expect(
      members.filter(member => [firstCandidateId, secondCandidateId].includes(member.userId)),
    ).toHaveLength(1);
  });
});
