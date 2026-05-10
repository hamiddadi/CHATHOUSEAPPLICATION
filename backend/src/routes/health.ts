import { Router } from 'express';
import { prisma } from '../config/database';
import { redis } from '../config/redis';
import { asyncHandler } from '../utils/asyncHandler';

export const healthRouter = Router();

/**
 * Liveness + readiness — returns 200 only when every dep is healthy, so
 * Kubernetes / ECS health checks can pull the pod out of rotation when
 * Postgres or Redis is down.
 */
healthRouter.get(
  '/health',
  asyncHandler(async (_req, res) => {
    const dbOk = await prisma.$queryRaw`SELECT 1`.then(() => true).catch(() => false);
    const redisOk = await redis
      .ping()
      .then(() => true)
      .catch(() => false);

    const allOk = dbOk && redisOk;
    res.status(allOk ? 200 : 503).json({
      status: allOk ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      services: {
        database: dbOk,
        redis: redisOk,
      },
    });
  }),
);

healthRouter.get('/health/live', (_req, res) => {
  res.status(200).json({ status: 'alive', timestamp: new Date().toISOString() });
});
