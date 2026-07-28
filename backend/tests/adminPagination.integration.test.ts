process.env.DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://chathouse:chathouse@localhost:5434/chathouse_test?schema=public';

/* eslint-disable @typescript-eslint/no-require-imports */
const { prisma } = require('../src/config/database') as typeof import('../src/config/database');
const { adminService } =
  require('../src/modules/admin/admin.service') as typeof import('../src/modules/admin/admin.service');
const { decodeAdminCursor } =
  require('../src/modules/admin/admin.cursor') as typeof import('../src/modules/admin/admin.cursor');
/* eslint-enable @typescript-eslint/no-require-imports */

const random = () => Math.random().toString(36).slice(2, 10);

describe('stable admin keyset pagination', () => {
  const tag = `cursor_${random()}`;
  const createdAt = new Date('2099-07-20T12:34:56.789Z');
  const userIds = [0, 1, 2, 3].map(index => `${tag}_user_${index}`);
  const reportIds = [0, 1, 2, 3].map(index => `${tag}_report_${index}`);
  const auditIds = [0, 1, 2, 3].map(index => `${tag}_audit_${index}`);

  beforeAll(async () => {
    await prisma.user.createMany({
      data: userIds.map((id, index) => ({
        id,
        username: `${tag}_${index}`,
        createdAt,
      })),
    });
    await prisma.report.createMany({
      data: reportIds.map(id => ({
        id,
        reporterId: userIds[0]!,
        reportedId: userIds[1]!,
        targetKind: 'USER',
        reason: 'SPAM',
        resolvedAt: createdAt,
        createdAt,
      })),
    });
    await prisma.auditLog.createMany({
      data: auditIds.map(id => ({
        id,
        actorId: userIds[0]!,
        action: 'REPORT_RESOLVED',
        targetType: 'report',
        targetId: reportIds[0],
        createdAt,
      })),
    });
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { id: { in: auditIds } } });
    await prisma.report.deleteMany({ where: { id: { in: reportIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  it('does not lose users that share the same createdAt value', async () => {
    const expected = [...userIds].sort().reverse();
    const seen: string[] = [];
    let cursor: string | undefined;

    for (let index = 0; index < expected.length; index += 1) {
      const page = await adminService.listUsers({
        q: tag,
        limit: 1,
        cursor,
      });
      expect(page.data).toHaveLength(1);
      seen.push(page.data[0]!.id);

      if (index < expected.length - 1) {
        expect(page.nextCursor).toEqual(expect.stringMatching(/^v1\./));
        const decoded = decodeAdminCursor(page.nextCursor!);
        expect(decoded).toMatchObject({ id: expected[index] });
        cursor = page.nextCursor!;
      }
    }

    expect(seen).toEqual(expected);

    const legacyPage = await adminService.listUsers({
      q: tag,
      limit: 10,
      cursor: createdAt.toISOString(),
    });
    expect(legacyPage.data).toEqual([]);
  });

  it('does not lose reports that share the same createdAt value', async () => {
    const expected = [...reportIds].sort().reverse();
    const seen: string[] = [];
    let cursor: string | undefined;

    for (let index = 0; index < expected.length; index += 1) {
      const page = await adminService.listReports({
        status: 'resolved',
        kind: 'USER',
        limit: 1,
        cursor,
      });
      expect(page.data).toHaveLength(1);
      seen.push(page.data[0]!.id);

      if (index < expected.length - 1) {
        expect(page.nextCursor).toEqual(expect.stringMatching(/^v1\./));
        cursor = page.nextCursor!;
      }
    }

    expect(seen).toEqual(expected);
  });

  it('does not lose audit entries that share the same createdAt value', async () => {
    const expected = [...auditIds].sort().reverse();
    const seen: string[] = [];
    let cursor: string | undefined;

    for (let index = 0; index < expected.length; index += 1) {
      const page = await adminService.listAuditLog({
        actorId: userIds[0]!,
        limit: 1,
        cursor,
      });
      expect(page.data).toHaveLength(1);
      seen.push(page.data[0]!.id);

      if (index < expected.length - 1) {
        expect(page.nextCursor).toEqual(expect.stringMatching(/^v1\./));
        cursor = page.nextCursor!;
      }
    }

    expect(seen).toEqual(expected);
  });
});

export {};
