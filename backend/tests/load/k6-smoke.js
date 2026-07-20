import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://127.0.0.1:4000';

export const options = {
  scenarios: {
    authenticated_mobile_reads: {
      executor: 'constant-vus',
      vus: 10,
      duration: '30s',
      gracefulStop: '5s',
    },
  },
  thresholds: {
    checks: ['rate>0.99'],
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<1000'],
  },
};

export function setup() {
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
      headers: { 'Content-Type': 'application/json' },
      tags: { name: 'POST /api/auth/register [setup]' },
    },
  );
  const registered = check(registration, {
    'load user registered': response => response.status === 201,
  });
  if (!registered) {
    throw new Error(`Unable to create load user: HTTP ${registration.status}`);
  }
  return { accessToken: registration.json('data.accessToken') };
}

export default function (data) {
  const params = {
    headers: { Authorization: `Bearer ${data.accessToken}` },
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
