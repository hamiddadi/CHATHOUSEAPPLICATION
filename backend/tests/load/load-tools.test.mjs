import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  createFunctionalLoadConfig,
  parseBoundedInteger,
  parseBoundedRatio,
  parseDuration,
  validateLoadTarget,
  validateLocalRedisTarget,
} from '../../scripts/load-test-config.mjs';

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = path.resolve(TEST_DIR, '..', '..');

test('functional load defaults are bounded, local and non-destructive', () => {
  const config = createFunctionalLoadConfig({});

  assert.equal(config.apiUrl, 'http://127.0.0.1:4000');
  assert.equal(config.target.local, true);
  assert.equal(config.users, 50);
  assert.equal(config.concurrency, 10);
  assert.equal(config.resetRateLimits, false);
  assert.equal(config.maxFailureRate, 0);
});

test('numeric and duration options fail closed outside their bounds', () => {
  assert.equal(parseBoundedInteger('USERS', '25', { defaultValue: 10, min: 2, max: 50 }), 25);
  assert.throws(
    () => parseBoundedInteger('USERS', '2.5', { defaultValue: 10, min: 2, max: 50 }),
    /integer between 2 and 50/u,
  );
  assert.equal(parseBoundedRatio('FAILURE_RATE', '0.05', 0), 0.05);
  assert.throws(() => parseBoundedRatio('FAILURE_RATE', '1', 0), /less than 1/u);
  assert.equal(parseDuration('DURATION', '2m'), '2m');
  assert.throws(() => parseDuration('DURATION', '20m'), /between 1s and 15m/u);
});

test('remote load targets require HTTPS, opt-in and exact confirmation', () => {
  assert.throws(
    () => validateLoadTarget('https://staging.example.net', {}),
    /LOAD_TEST_ALLOW_REMOTE=true/u,
  );
  assert.throws(
    () =>
      validateLoadTarget('https://staging.example.net', {
        LOAD_TEST_ALLOW_REMOTE: 'true',
        LOAD_TEST_CONFIRM_TARGET: 'https://other.example.net',
      }),
    /must exactly equal https:\/\/staging\.example\.net/u,
  );
  assert.throws(
    () =>
      validateLoadTarget('http://staging.example.net', {
        LOAD_TEST_ALLOW_REMOTE: 'true',
        LOAD_TEST_CONFIRM_TARGET: 'http://staging.example.net',
      }),
    /must use https/u,
  );
  assert.throws(
    () => validateLoadTarget('http://127.999.999.999:4000', {}),
    /must use https for a remote target/u,
  );

  const target = validateLoadTarget('https://staging.example.net/', {
    LOAD_TEST_ALLOW_REMOTE: 'true',
    LOAD_TEST_CONFIRM_TARGET: 'https://staging.example.net',
  });
  assert.equal(target.local, false);
  assert.equal(target.production, false);
});

test('known ChatHouse production targets require a third explicit gate', () => {
  const remoteConfirmation = {
    LOAD_TEST_ALLOW_REMOTE: 'true',
    LOAD_TEST_CONFIRM_TARGET: 'https://api.chathouse.app',
  };
  assert.throws(
    () => validateLoadTarget('https://api.chathouse.app', remoteConfirmation),
    /LOAD_TEST_ALLOW_PRODUCTION=true/u,
  );
  assert.throws(
    () =>
      validateLoadTarget('https://api.chathouse.app.', {
        LOAD_TEST_ALLOW_REMOTE: 'true',
        LOAD_TEST_CONFIRM_TARGET: 'https://api.chathouse.app',
      }),
    /LOAD_TEST_ALLOW_PRODUCTION=true/u,
  );

  const target = validateLoadTarget('https://api.chathouse.app', {
    ...remoteConfirmation,
    LOAD_TEST_ALLOW_PRODUCTION: 'true',
  });
  assert.equal(target.production, true);
});

test('rate-limit mutation is opt-in and restricted to loopback Redis', () => {
  assert.match(validateLocalRedisTarget('redis://127.0.0.1:6379/0'), /^redis:/u);
  assert.throws(
    () => validateLocalRedisTarget('rediss://cache.staging.example.net:6379'),
    /restricted to a loopback Redis/u,
  );
  assert.throws(
    () =>
      createFunctionalLoadConfig({
        LOAD_TEST_RESET_RATE_LIMITS: 'true',
        LOAD_TEST_REDIS_URL: 'redis://cache.staging.example.net:6379',
      }),
    /restricted to a loopback Redis/u,
  );
});

test('functional CLI check validates configuration without network traffic', () => {
  const valid = spawnSync(process.execPath, ['scripts/load-50-users.mjs', '--check'], {
    cwd: BACKEND_ROOT,
    encoding: 'utf8',
    env: { ...process.env, LOAD_TEST_API_URL: 'http://127.0.0.1:9' },
  });
  assert.equal(valid.status, 0, valid.stderr);
  assert.equal(JSON.parse(valid.stdout).valid, true);

  const unsafe = spawnSync(process.execPath, ['scripts/load-50-users.mjs', '--check'], {
    cwd: BACKEND_ROOT,
    encoding: 'utf8',
    env: {
      ...process.env,
      LOAD_TEST_API_URL: 'https://staging.example.net',
      LOAD_TEST_ALLOW_REMOTE: 'false',
      LOAD_TEST_CONFIRM_TARGET: '',
    },
  });
  assert.equal(unsafe.status, 2);
  assert.match(unsafe.stderr, /LOAD_TEST_ALLOW_REMOTE=true/u);
});

test('functional runner uses bounded requests and never issues Redis KEYS', () => {
  const source = readFileSync(path.join(BACKEND_ROOT, 'scripts', 'load-50-users.mjs'), 'utf8');

  assert.match(source, /AbortSignal\.timeout\(REQUEST_TIMEOUT_MS\)/u);
  assert.match(source, /redirect: 'error'/u);
  assert.match(source, /redis\.scan\(/u);
  assert.doesNotMatch(source, /redis\.keys\(/u);
  assert.match(source, /failureRate <= MAX_FAILURE_RATE/u);
  assert.match(source, /target health check failed/u);
});

test('k6 smoke test retains the shared guard, timeouts and aborting thresholds', () => {
  const source = readFileSync(path.join(TEST_DIR, 'k6-smoke.js'), 'utf8');

  assert.match(source, /validateLoadTarget/u);
  assert.match(source, /exec\.test\.abort/u);
  assert.match(source, /GET \/health \[setup\]/u);
  assert.match(source, /timeout: `\$\{REQUEST_TIMEOUT_MS\}ms`/u);
  assert.match(source, /abortOnFail: true/u);
  assert.doesNotMatch(source, /https:\/\/api\.chathouse\.(?:app|com)/u);
});

test('package scripts and CI expose the no-traffic validation command', () => {
  const packageJson = JSON.parse(readFileSync(path.join(BACKEND_ROOT, 'package.json'), 'utf8'));
  assert.equal(
    packageJson.scripts['test:load-tools'],
    'node --test tests/load/load-tools.test.mjs',
  );
  assert.match(packageJson.scripts['load:check'], /load-50-users\.mjs --check/u);
  assert.equal(packageJson.scripts['load:functional'], 'node scripts/load-50-users.mjs');
  assert.equal(packageJson.scripts['load:k6'], 'k6 run tests/load/k6-smoke.js');

  const workflow = readFileSync(
    path.resolve(BACKEND_ROOT, '..', '.github', 'workflows', 'ci.yml'),
    'utf8',
  );
  assert.match(workflow, /Validate load tooling without sending traffic[\s\S]*npm run load:check/u);
  assert.match(workflow, /-e LOAD_TEST_API_URL=http:\/\/127\.0\.0\.1:4000/u);
});
