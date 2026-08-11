process.env.DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://chathouse:chathouse@localhost:5434/chathouse_test?schema=public';
process.env.REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
const adminRaceDatabaseUrl = new URL(process.env.DATABASE_URL);
adminRaceDatabaseUrl.searchParams.set('connection_limit', '10');
process.env.DATABASE_URL = adminRaceDatabaseUrl.toString();

/* eslint-disable @typescript-eslint/no-require-imports */
const { prisma } = require('../src/config/database') as typeof import('../src/config/database');
const { adminService } =
  require('../src/modules/admin/admin.service') as typeof import('../src/modules/admin/admin.service');
/* eslint-enable @typescript-eslint/no-require-imports */

const tag = Math.random().toString(36).slice(2, 10);
const actorId = `admin_race_${tag}_zz_actor`;
const targetId = `admin_race_${tag}_aa_target`;
const context = { ip: null, userAgent: null };

const failureCode = (result: { ok: boolean; error?: unknown }): string | undefined => {
  if (result.ok || !result.error || typeof result.error !== 'object') return undefined;
  return (result.error as { code?: string }).code;
};

/**
 * targetId sorts before actorId, so its lock proves that the service passed
 * preflight and is blocked later in the same ordered SELECT on the actor row.
 */
const waitForUserRowLock = async (userId: string): Promise<void> => {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try {
      await prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE NOWAIT`;
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/55P03|could not obtain lock|lock not available/i.test(message)) return;
      throw error;
    }
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for User row lock: ${userId}`);
};

const raceActorChange = async (
  mutation: () => Promise<unknown>,
  changeActor: (tx: import('@prisma/client').Prisma.TransactionClient) => Promise<unknown>,
): Promise<{ ok: boolean; error?: unknown }> => {
  let observed!: Promise<{ ok: boolean; error?: unknown }>;
  await prisma.$transaction(
    async tx => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${actorId} FOR UPDATE`;
      observed = mutation().then(
        () => ({ ok: true }),
        (error: unknown) => ({ ok: false, error }),
      );
      await waitForUserRowLock(targetId);
      await changeActor(tx);
    },
    { maxWait: 5_000, timeout: 15_000 },
  );
  return observed;
};

describe('admin actor authorization is revalidated under the mutation lock', () => {
  beforeAll(async () => {
    await prisma.user.createMany({
      data: [
        { id: actorId, username: `${tag}_actor`, appRole: 'SUPER_ADMIN' },
        {
          id: targetId,
          username: `${tag}_target`,
          appRole: 'USER',
          suspendedUntil: new Date(Date.now() + 60 * 60_000),
          suspensionReason: 'race fixture',
        },
      ],
    });
  });

  beforeEach(async () => {
    await prisma.user.update({
      where: { id: actorId },
      data: { appRole: 'SUPER_ADMIN', suspendedUntil: null, deletedAt: null },
    });
    await prisma.user.update({
      where: { id: targetId },
      data: {
        appRole: 'USER',
        suspendedUntil: new Date(Date.now() + 60 * 60_000),
        suspensionReason: 'race fixture',
        deletedAt: null,
      },
    });
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { actorId } });
    await prisma.user.deleteMany({ where: { id: { in: [actorId, targetId] } } });
    await prisma.$disconnect();
  });

  it('rejects setRole when the actor is suspended while waiting for its row lock', async () => {
    const result = await raceActorChange(
      () => adminService.setRole(actorId, targetId, { role: 'ADMIN' }, context),
      tx =>
        tx.user.update({
          where: { id: actorId },
          data: { suspendedUntil: new Date(Date.now() + 60 * 60_000) },
        }),
    );

    expect(failureCode(result)).toBe('AUTH_007');
    expect((await prisma.user.findUnique({ where: { id: targetId } }))?.appRole).toBe('USER');
  });

  it('rejects unsuspend when the actor is deleted while waiting for its row lock', async () => {
    const result = await raceActorChange(
      () => adminService.unsuspend(actorId, targetId, context),
      tx => tx.user.update({ where: { id: actorId }, data: { deletedAt: new Date() } }),
    );

    expect(failureCode(result)).toBe('AUTH_003');
    expect(
      (await prisma.user.findUnique({ where: { id: targetId } }))?.suspendedUntil,
    ).not.toBeNull();
  });

  it('rejects suspend when the actor is demoted below moderator under the helper lock', async () => {
    const result = await raceActorChange(
      () =>
        adminService.suspend(
          actorId,
          targetId,
          { reason: 'must not land', durationMinutes: 30 },
          context,
        ),
      tx => tx.user.update({ where: { id: actorId }, data: { appRole: 'USER' } }),
    );

    expect(failureCode(result)).toBe('AUTH_008');
    expect((await prisma.user.findUnique({ where: { id: targetId } }))?.suspensionReason).toBe(
      'race fixture',
    );
  });

  it('rejects deleteUser when the actor is suspended under the helper lock', async () => {
    const result = await raceActorChange(
      () => adminService.deleteUser(actorId, targetId, context),
      tx =>
        tx.user.update({
          where: { id: actorId },
          data: { suspendedUntil: new Date(Date.now() + 60 * 60_000) },
        }),
    );

    expect(failureCode(result)).toBe('AUTH_007');
    expect((await prisma.user.findUnique({ where: { id: targetId } }))?.deletedAt).toBeNull();
  });
});

export {};
