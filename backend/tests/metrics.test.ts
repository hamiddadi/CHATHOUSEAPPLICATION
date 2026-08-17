import express from 'express';
import request from 'supertest';
import { recordDatabaseQueryMetrics } from '../src/config/database';
import {
  dbQueryDuration,
  httpMetricsMiddleware,
  httpRequestTotal,
} from '../src/monitoring/metrics';

describe('HTTP metrics labels', () => {
  it('collapses attacker-controlled 404 paths into one bounded series', async () => {
    const app = express();
    app.use(httpMetricsMiddleware);
    app.use((_req, res) => res.sendStatus(404));

    await request(app).get('/missing-one').expect(404);
    await request(app).get('/missing-two').expect(404);

    const metric = await httpRequestTotal.get();
    const unmatched = metric.values.filter(
      sample =>
        sample.labels.method === 'GET' &&
        sample.labels.status_code === '404' &&
        sample.labels.route === 'unmatched',
    );

    expect(unmatched).toHaveLength(1);
    expect(unmatched[0]?.value).toBeGreaterThanOrEqual(2);
    expect(metric.values.some(sample => sample.labels.route === '/missing-one')).toBe(false);
    expect(metric.values.some(sample => sample.labels.route === '/missing-two')).toBe(false);
  });
});

describe('database metrics labels', () => {
  it('records bounded SQL operation labels without query text or parameters', async () => {
    dbQueryDuration.reset();
    recordDatabaseQueryMetrics({ duration: 25, query: 'SELECT * FROM "User" WHERE id = $1' });

    const metric = await dbQueryDuration.get();
    const count = metric.values.find(
      sample =>
        sample.metricName === 'chathouse_db_query_duration_seconds_count' &&
        sample.labels.operation === 'select' &&
        sample.labels.model === 'sql',
    );
    expect(count?.value).toBe(1);
    expect(JSON.stringify(metric.values)).not.toContain('User');
  });
});
