import { prisma } from '../src/config/database';
import {
  createUserDataExportStream,
  streamJsonArrayInBatches,
  USER_EXPORT_BATCH_SIZE,
} from '../src/modules/users/userDataExport.service';

describe('bounded GDPR JSON streaming', () => {
  afterEach(() => jest.restoreAllMocks());

  it('serializes more than 5000 rows lazily while retaining one bounded page', async () => {
    const rows = Array.from({ length: 5_001 }, (_, index) => ({
      id: `row-${String(index).padStart(5, '0')}`,
      value: index,
    }));
    let largestPage = 0;
    const loadPage = jest.fn(async (afterId?: string) => {
      const start = afterId ? rows.findIndex(row => row.id === afterId) + 1 : 0;
      const page = rows.slice(start, start + USER_EXPORT_BATCH_SIZE);
      largestPage = Math.max(largestPage, page.length);
      return page;
    });
    const stream = streamJsonArrayInBatches(loadPage, row => row);

    expect(await stream.next()).toEqual({ value: '[', done: false });
    expect(loadPage).not.toHaveBeenCalled();

    const chunks = ['['];
    for await (const chunk of stream) chunks.push(chunk);
    const parsed = JSON.parse(chunks.join('')) as typeof rows;

    expect(parsed).toHaveLength(5_001);
    expect(parsed.at(-1)).toEqual(rows.at(-1));
    expect(largestPage).toBe(USER_EXPORT_BATCH_SIZE);
    expect(loadPage).toHaveBeenCalledTimes(Math.ceil(rows.length / USER_EXPORT_BATCH_SIZE));
  });

  it('validates profile existence before returning an HTTP-streamable iterator', async () => {
    const findProfile = jest.spyOn(prisma.user, 'findUnique').mockResolvedValue(null);

    await expect(
      createUserDataExportStream('missing-user', 'https://api.example.test'),
    ).rejects.toMatchObject({ code: 'USER_001' });
    expect(findProfile).toHaveBeenCalledTimes(1);
  });
});
