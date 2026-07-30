process.env.DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://chathouse:chathouse@localhost:5433/chathouse?schema=public';

export {};

/* eslint-disable @typescript-eslint/no-require-imports */
const { prisma } = require('../src/config/database') as typeof import('../src/config/database');
const { issueTokenPair } =
  require('../src/utils/issueTokenPair') as typeof import('../src/utils/issueTokenPair');
/* eslint-enable @typescript-eslint/no-require-imports */

describe('issueTokenPair concurrency', () => {
  let userId: string;

  beforeEach(async () => {
    const user = await prisma.user.create({
      data: {
        username: `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      },
      select: { id: true },
    });
    userId = user.id;
  });

  afterEach(async () => {
    await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('keeps at most ten active sessions under concurrent issuance', async () => {
    const pairs = await Promise.all(Array.from({ length: 16 }, () => issueTokenPair(userId)));

    expect(new Set(pairs.map(pair => pair.refreshToken)).size).toBe(16);
    const active = await prisma.refreshToken.count({
      where: {
        userId,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
    });
    expect(active).toBe(10);
  });
});
