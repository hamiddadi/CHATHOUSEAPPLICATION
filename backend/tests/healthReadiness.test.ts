import express from 'express';
import request from 'supertest';

const mockDatabaseCheck = jest.fn();
const mockRedisCheck = jest.fn();

jest.mock('../src/config/database', () => ({
  prisma: { $queryRaw: (...args: unknown[]) => mockDatabaseCheck(...args) },
}));
jest.mock('../src/config/redis', () => ({ redis: {} }));
jest.mock('../src/monitoring/redisMetrics', () => ({
  checkRedisReadiness: (...args: unknown[]) => mockRedisCheck(...args),
}));

// Load after dependency mocks so this remains a fast, infrastructure-free test.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { healthRouter } = require('../src/routes/health') as typeof import('../src/routes/health');

const app = express().use(healthRouter);

describe('GET /health Redis readiness', () => {
  beforeEach(() => {
    mockDatabaseCheck.mockResolvedValue([{ '?column?': 1 }]);
    mockRedisCheck.mockResolvedValue(true);
  });

  it('returns healthy when Postgres and non-destructive Redis readiness pass', async () => {
    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.body.services).toEqual({ database: true, redis: true });
  });

  it('returns 503 while Redis is connected but memory readiness is withdrawn', async () => {
    mockRedisCheck.mockResolvedValue(false);

    const response = await request(app).get('/health');

    expect(response.status).toBe(503);
    expect(response.body).toMatchObject({
      status: 'degraded',
      services: { database: true, redis: false },
    });
  });
});
