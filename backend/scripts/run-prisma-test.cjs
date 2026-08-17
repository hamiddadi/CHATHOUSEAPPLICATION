'use strict';

const { spawnSync } = require('node:child_process');
const path = require('node:path');

const defaultUrl = 'postgresql://chathouse:chathouse@localhost:5434/chathouse_test?schema=public';
const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? defaultUrl;
const databaseName = decodeURIComponent(new URL(databaseUrl).pathname)
  .replace(/^\/+/, '')
  .split('/')[0];

if (!/(^|[_-])test($|[_-])/i.test(databaseName)) {
  console.error(
    `[test:db] Refusing unsafe database "${databaseName}". ` +
      'TEST_DATABASE_URL/DATABASE_URL must contain "test" in the database name.',
  );
  process.exit(1);
}

const prismaCli = path.join(__dirname, '..', 'node_modules', 'prisma', 'build', 'index.js');
const result = spawnSync(process.execPath, [prismaCli, ...process.argv.slice(2)], {
  cwd: path.join(__dirname, '..'),
  env: { ...process.env, NODE_ENV: 'test', DATABASE_URL: databaseUrl },
  stdio: 'inherit',
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
