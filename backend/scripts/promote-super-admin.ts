/**
 * One-shot script to promote a user to SUPER_ADMIN. Run with:
 *
 *   npx tsx scripts/promote-super-admin.ts <id-or-username-or-phone>
 *   npx tsx scripts/promote-super-admin.ts --list                # peek the first 20 users
 *
 * Resolves the target by id, then username, then phoneNumber. The lookup
 * is intentionally permissive so the operator can paste whatever handle
 * they have without remembering the cuid.
 *
 * Cross-platform: no psql / docker dependency. Uses the Prisma client
 * already installed in node_modules.
 */
import { PrismaClient, type AppRole } from '@prisma/client';

const prisma = new PrismaClient();

const TARGET_ROLE: AppRole = 'SUPER_ADMIN';

const printUserRow = (u: {
  id: string;
  username: string | null;
  displayName: string | null;
  phoneNumber: string | null;
  email: string | null;
  appRole: AppRole;
}): void => {
  // eslint-disable-next-line no-console
  console.log(
    `  ${u.id}  ${u.appRole.padEnd(13)}  @${(u.username ?? '—').padEnd(20)}  ${u.displayName ?? ''}  ${u.phoneNumber ?? u.email ?? ''}`,
  );
};

const list = async (): Promise<void> => {
  const rows = await prisma.user.findMany({
    select: {
      id: true,
      username: true,
      displayName: true,
      phoneNumber: true,
      email: true,
      appRole: true,
    },
    orderBy: { createdAt: 'asc' },
    take: 20,
  });
  if (rows.length === 0) {
    // eslint-disable-next-line no-console
    console.log('No users in database. Run `npm run seed` first or sign up via the app.');
    return;
  }
  // eslint-disable-next-line no-console
  console.log(`First ${rows.length} users (chronological):`);
  for (const r of rows) printUserRow(r);
};

const findUser = async (
  needle: string,
): Promise<Awaited<ReturnType<typeof prisma.user.findFirst>>> => {
  // Try id first (cuids start with `c` and are ~25 chars). Then username.
  // Then phone — strip everything but digits and `+` so a copy-paste with
  // spaces or formatting still matches.
  return prisma.user.findFirst({
    where: {
      OR: [{ id: needle }, { username: needle }, { phoneNumber: needle }, { email: needle }],
    },
  });
};

const main = async (): Promise<void> => {
  const arg = process.argv[2];
  if (!arg || arg === '--help' || arg === '-h') {
    // eslint-disable-next-line no-console
    console.log(
      [
        'Usage: npx tsx scripts/promote-super-admin.ts <id|username|phone|email>',
        '       npx tsx scripts/promote-super-admin.ts --list',
        '',
        'Promotes the matching user to SUPER_ADMIN. Idempotent.',
      ].join('\n'),
    );
    process.exit(arg ? 0 : 1);
    return;
  }

  if (arg === '--list') {
    await list();
    return;
  }

  const user = await findUser(arg);
  if (!user) {
    // eslint-disable-next-line no-console
    console.error(
      `❌ No user matched "${arg}". Try \`npx tsx scripts/promote-super-admin.ts --list\` to see candidates.`,
    );
    process.exit(2);
  }

  if (user.appRole === TARGET_ROLE) {
    // eslint-disable-next-line no-console
    console.log(`ℹ️  @${user.username ?? user.id} is already ${TARGET_ROLE}. Nothing to do.`);
    return;
  }

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { appRole: TARGET_ROLE },
    select: {
      id: true,
      username: true,
      displayName: true,
      phoneNumber: true,
      email: true,
      appRole: true,
    },
  });

  // eslint-disable-next-line no-console
  console.log(`✅ Promoted user to ${TARGET_ROLE}:`);
  printUserRow(updated);
  // eslint-disable-next-line no-console
  console.log(
    '\n→ The change takes effect on this user’s next request (suspension/role cache TTL is short).',
  );
};

main()
  .catch(err => {
    // eslint-disable-next-line no-console
    console.error('Fatal error:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
