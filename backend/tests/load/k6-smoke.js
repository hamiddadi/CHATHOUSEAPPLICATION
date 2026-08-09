/* eslint-disable import/no-unresolved -- k6 core modules are provided by the k6 runtime. */
import http from 'k6/http';
import { check, sleep } from 'k6';
import exec from 'k6/execution';
import {
  parseBoundedInteger,
  parseBoundedRatio,
  parseDuration,
  validateLoadTarget,
} from '../../scripts/load-test-config.mjs';

const TARGET = validateLoadTarget(
  __ENV.LOAD_TEST_API_URL || __ENV.BASE_URL || 'http://127.0.0.1:4000',
  __ENV,
);
const BASE_URL = TARGET.origin;
const VUS = parseBoundedInteger('LOAD_TEST_VUS', __ENV.LOAD_TEST_VUS, {
  defaultValue: 10,
  min: 1,
  max: 100,
});
const DURATION = parseDuration('LOAD_TEST_DURATION', __ENV.LOAD_TEST_DURATION, '30s');
const GRACEFUL_STOP = parseDuration('LOAD_TEST_GRACEFUL_STOP', __ENV.LOAD_TEST_GRACEFUL_STOP, '5s');
const REQUEST_TIMEOUT_MS = parseBoundedInteger(
  'LOAD_TEST_REQUEST_TIMEOUT_MS',
  __ENV.LOAD_TEST_REQUEST_TIMEOUT_MS,
  { defaultValue: 5_000, min: 1_000, max: 30_000 },
);
const P95_MS = parseBoundedInteger('LOAD_TEST_P95_MS', __ENV.LOAD_TEST_P95_MS, {
  defaultValue: 1_000,
  min: 50,
  max: 60_000,
});
const MAX_HTTP_FAILURE_RATE = parseBoundedRatio(
  'LOAD_TEST_MAX_HTTP_FAILURE_RATE',
  __ENV.LOAD_TEST_MAX_HTTP_FAILURE_RATE,
  0.01,
);
const MAX_CHECK_FAILURE_RATE = parseBoundedRatio(
  'LOAD_TEST_MAX_CHECK_FAILURE_RATE',
  __ENV.LOAD_TEST_MAX_CHECK_FAILURE_RATE,
  0.01,
);

export const options = {
  scenarios: {
    authenticated_mobile_reads: {
      executor: 'constant-vus',
      vus: VUS,
      duration: DURATION,
      gracefulStop: GRACEFUL_STOP,
    },
  },
  thresholds: {
    checks: [
      {
        threshold: `rate>=${1 - MAX_CHECK_FAILURE_RATE}`,
        abortOnFail: true,
        delayAbortEval: '10s',
      },
    ],
    http_req_failed: [
      {
        threshold: `rate<=${MAX_HTTP_FAILURE_RATE}`,
        abortOnFail: true,
        delayAbortEval: '10s',
      },
    ],
    http_req_duration: [`p(95)<${P95_MS}`],
  },
  maxRedirects: 0,
  setupTimeout: '30s',
};

export function setup() {
  const requestOptions = {
    redirects: 0,
    timeout: `${REQUEST_TIMEOUT_MS}ms`,
  };
  const health = http.get(`${BASE_URL}/health`, {
    ...requestOptions,
    tags: { name: 'GET /health [setup]' },
  });
  if (health.status !== 200 || health.json('status') !== 'healthy') {
    exec.test.abort(`Load target is not healthy: HTTP ${health.status}`);
  }

  const suffix = `${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6)}`;
  const username = `load_${suffix}`.slice(0, 24);
  const registration = http.post(
    `${BASE_URL}/api/auth/register`,
    JSON.stringify({
      username,
      email: `${username}@load.test`,
      password: 'load-test-password-123',
      ageConfirmed: true,
    }),
    {
      ...requestOptions,
      headers: { 'Content-Type': 'application/json' },
      tags: { name: 'POST /api/auth/register [setup]' },
    },
  );
  const registered = check(registration, {
    'load user registered': response => response.status === 201,
  });
  if (!registered) {
    exec.test.abort(`Unable to create load user: HTTP ${registration.status}`);
  }
  const accessToken = registration.json('data.accessToken');
  if (!accessToken) exec.test.abort('Registration response did not contain an access token');
  return { accessToken };
}

export default function (data) {
  const params = {
    headers: { Authorization: `Bearer ${data.accessToken}` },
    redirects: 0,
    timeout: `${REQUEST_TIMEOUT_MS}ms`,
  };
  const responses = http.batch([
    ['GET', `${BASE_URL}/api/users/me`, null, { ...params, tags: { name: 'GET /api/users/me' } }],
    [
      'GET',
      `${BASE_URL}/api/rooms?limit=20`,
      null,
      { ...params, tags: { name: 'GET /api/rooms' } },
    ],
    [
      'GET',
      `${BASE_URL}/api/maps/users`,
      null,
      { ...params, tags: { name: 'GET /api/maps/users' } },
    ],
  ]);

  check(responses[0], { 'profile returned 200': response => response.status === 200 });
  check(responses[1], { 'rooms returned 200': response => response.status === 200 });
  check(responses[2], { 'map roster returned 200': response => response.status === 200 });
  sleep(1);
}
