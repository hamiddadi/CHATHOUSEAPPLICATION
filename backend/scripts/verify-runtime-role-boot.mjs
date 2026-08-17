#!/usr/bin/env node

import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const databaseUrl = process.env.TEST_APP_DATABASE_URL || process.env.DATABASE_URL;
const redisUrl = process.env.REDIS_URL;
const port = Number(process.env.RUNTIME_ROLE_BOOT_PORT || 4011);

if (!databaseUrl || !redisUrl) {
  throw new Error('TEST_APP_DATABASE_URL/DATABASE_URL and REDIS_URL are required');
}

const parsedDatabaseUrl = new URL(databaseUrl);
const databaseName = parsedDatabaseUrl.pathname.replace(/^\//u, '');
if (!databaseName.toLowerCase().includes('test')) {
  throw new Error(`Refusing non-test database "${databaseName}"`);
}
if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  throw new Error('RUNTIME_ROLE_BOOT_PORT must be an unprivileged TCP port');
}

const output = [];
const recordOutput = chunk => {
  output.push(String(chunk));
  while (output.join('').length > 16_384) output.shift();
};
const redact = value =>
  value
    .replace(/postgres(?:ql)?:\/\/[^\s"']+/giu, 'postgresql://[redacted]')
    .replace(/redis:\/\/[^\s"']+/giu, 'redis://[redacted]');

const child = spawn(process.execPath, ['dist/app.js'], {
  cwd: backendRoot,
  env: {
    ...process.env,
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: String(port),
    DATABASE_URL: databaseUrl,
    REDIS_URL: redisUrl,
    JWT_ACCESS_SECRET: 'runtime_role_boot_access_secret_0123456789',
    JWT_REFRESH_SECRET: 'runtime_role_boot_refresh_secret_01234567',
    EXTENSIONS_ENABLED: 'false',
    MEDIASOUP_ENABLED: 'false',
    ROOM_RECORDING_ENABLED: 'false',
    PUSH_DISPATCH_ENABLED: 'false',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
});
child.stdout.on('data', recordOutput);
child.stderr.on('data', recordOutput);

const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

try {
  let health;
  let lastHealthResponse;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (child.exitCode !== null) break;
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`, {
        signal: AbortSignal.timeout(2_000),
      });
      const body = await response.json();
      lastHealthResponse = { httpStatus: response.status, body };
      if (
        response.ok &&
        body?.status === 'healthy' &&
        body?.services?.database === true &&
        body?.services?.redis === true
      ) {
        health = body;
        break;
      }
    } catch {
      // Boot is still in progress.
    }
    await wait(1_000);
  }

  if (!health) {
    const diagnostics = redact(output.join('')).trim();
    throw new Error(
      `Restricted-role API boot failed` +
        `${lastHealthResponse ? `\nLast health response: ${JSON.stringify(lastHealthResponse)}` : ''}` +
        `${diagnostics ? `\n${diagnostics}` : ''}`,
    );
  }
  console.log(
    JSON.stringify({
      status: health.status,
      services: health.services,
      runtimeDatabaseRole: parsedDatabaseUrl.username,
    }),
  );
} finally {
  if (child.exitCode === null) {
    child.kill('SIGTERM');
    await Promise.race([new Promise(resolve => child.once('exit', resolve)), wait(5_000)]);
  }
  if (child.exitCode === null) child.kill('SIGKILL');
}
