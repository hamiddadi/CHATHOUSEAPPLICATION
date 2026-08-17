import { Writable } from 'node:stream';
import type { Request, Response } from 'express';
import { prisma } from '../src/config/database';
import { adminController } from '../src/modules/admin/admin.controller';
import { adminService, CSV_EXPORT_BATCH_SIZE } from '../src/modules/admin/admin.service';

const ROW_COUNT = 5_001;
const createdAt = new Date('2030-01-01T00:00:00.000Z');
const ids = (prefix: string): string[] =>
  Array.from(
    { length: ROW_COUNT },
    (_, index) => `${prefix}-${String(ROW_COUNT - index - 1).padStart(5, '0')}`,
  );

const collect = async (chunks: AsyncIterable<string>): Promise<string> => {
  const output: string[] = [];
  for await (const chunk of chunks) output.push(chunk);
  return output.join('');
};

const queuePages = (spy: jest.SpyInstance, rows: readonly unknown[]): void => {
  for (let offset = 0; offset < rows.length; offset += CSV_EXPORT_BATCH_SIZE) {
    spy.mockResolvedValueOnce(rows.slice(offset, offset + CSV_EXPORT_BATCH_SIZE));
  }
};

const expectCompleteAndBounded = (
  csv: string,
  spy: jest.SpyInstance,
  expectedLastIdOnFirstPage: string,
): void => {
  expect(csv.split('\r\n')).toHaveLength(ROW_COUNT + 1);
  expect(spy).toHaveBeenCalledTimes(Math.ceil(ROW_COUNT / CSV_EXPORT_BATCH_SIZE));
  for (const [query] of spy.mock.calls) {
    expect(query.take).toBe(CSV_EXPORT_BATCH_SIZE);
  }
  expect(spy.mock.calls[1]?.[0].where).toEqual({
    OR: [{ createdAt: { lt: createdAt } }, { createdAt, id: { lt: expectedLastIdOnFirstPage } }],
  });
};

describe('complete bounded admin CSV streams', () => {
  afterEach(() => jest.restoreAllMocks());

  it('preflights the first database page before committing download headers', async () => {
    jest.spyOn(prisma.user, 'findMany').mockRejectedValue(new Error('database unavailable'));
    const setHeader = jest.fn();

    await expect(
      adminController.exportUsersCsv({} as Request, { setHeader } as unknown as Response),
    ).rejects.toThrow('database unavailable');
    expect(setHeader).not.toHaveBeenCalled();
  });

  it('marks streamed admin CSV downloads as private and non-sniffable', async () => {
    jest.spyOn(prisma.user, 'findMany').mockResolvedValue([]);
    const body: string[] = [];
    const response = new Writable({
      write(chunk, _encoding, callback) {
        body.push(chunk.toString());
        callback();
      },
    });
    const setHeader = jest.fn().mockReturnValue(response);
    Object.assign(response, { setHeader });

    await adminController.exportUsersCsv({} as Request, response as unknown as Response);

    expect(setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
    expect(setHeader).toHaveBeenCalledWith('X-Content-Type-Options', 'nosniff');
    expect(body.join('')).toContain('"id","username","displayName"');
  });

  it('streams every user beyond the former 5000-row cap in stable pages', async () => {
    const rowIds = ids('user');
    const rows = rowIds.map(id => ({
      id,
      username: id,
      displayName: id,
      email: `${id}@example.test`,
      phoneNumber: null,
      appRole: 'USER',
      suspendedUntil: null,
      suspensionReason: null,
      deletedAt: null,
      followerCount: 0,
      followingCount: 0,
      createdAt,
      lastSeenAt: null,
    }));
    const findMany = jest.spyOn(prisma.user, 'findMany');
    queuePages(findMany, rows);

    const csv = await collect(adminService.exportUsersCsv());

    expectCompleteAndBounded(csv, findMany, rowIds[CSV_EXPORT_BATCH_SIZE - 1]!);
    expect(csv).toContain(`"${rowIds[0]}"`);
    expect(csv).toContain(`"${rowIds.at(-1)}"`);
  });

  it('streams every audit event beyond the former cap', async () => {
    const rowIds = ids('audit');
    const rows = rowIds.map(id => ({
      id,
      createdAt,
      action: 'ROLE_CHANGED',
      actorId: 'actor-1',
      actor: { username: 'admin', displayName: 'Admin' },
      targetUserId: null,
      targetUser: null,
      targetRoomId: null,
      targetType: 'user',
      targetId: id,
      metadata: null,
      ip: null,
      userAgent: null,
    }));
    const findMany = jest.spyOn(prisma.auditLog, 'findMany');
    queuePages(findMany, rows);

    const csv = await collect(adminService.exportAuditLogCsv());

    expectCompleteAndBounded(csv, findMany, rowIds[CSV_EXPORT_BATCH_SIZE - 1]!);
    expect(csv).toContain(`"${rowIds.at(-1)}"`);
  });

  it('streams every report beyond the former cap', async () => {
    const rowIds = ids('report');
    const rows = rowIds.map(id => ({
      id,
      createdAt,
      targetKind: 'USER',
      reason: 'SPAM',
      details: null,
      reporterId: 'reporter-1',
      reporter: { username: 'reporter' },
      reportedId: 'target-1',
      reported: { username: 'target' },
      reportedRoomId: null,
      reportedRoom: null,
      contentAuthorId: null,
      contentAuthor: null,
      reportedMessageId: null,
      reportedGroupMessageId: null,
      reportedRoomMessageId: null,
      contentKind: null,
      contentSnapshot: null,
      contentAudioUrl: null,
      contentAudioDurationMs: null,
      contentCreatedAt: null,
      contentContextId: null,
      contentContextSnapshot: null,
      resolvedAt: null,
    }));
    const findMany = jest.spyOn(prisma.report, 'findMany');
    queuePages(findMany, rows);

    const csv = await collect(adminService.exportReportsCsv());

    expectCompleteAndBounded(csv, findMany, rowIds[CSV_EXPORT_BATCH_SIZE - 1]!);
    expect(csv).toContain(`"${rowIds.at(-1)}"`);
  });
});
