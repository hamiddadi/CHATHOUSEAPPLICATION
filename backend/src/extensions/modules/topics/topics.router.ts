import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { requireAuth } from '../../../middlewares/auth.middleware';
import { asyncHandler } from '../../../utils/asyncHandler';
import { prisma } from '../../../config/database';
import { TOPICS, FLAT_TOPICS } from './topics.data';

export const topicsRouter: Router = Router();

topicsRouter.use(requireAuth);

topicsRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    res.json({ topics: TOPICS, total: FLAT_TOPICS.length });
  }),
);

// #61: real trending — rank topics by how many live public rooms carry them.
topicsRouter.get(
  '/trending',
  asyncHandler(async (_req, res) => {
    // Aggregate in PostgreSQL instead of materialising every live room in the
    // API process. DISTINCT(room, slug) preserves the previous rule that a
    // topic duplicated between `topic` and `topics[]` counts once per room.
    const rows = await prisma.$queryRaw<Array<{ slug: string; count: bigint }>>(Prisma.sql`
      SELECT topic.slug, COUNT(*)::bigint AS count
      FROM (
        SELECT DISTINCT room.id, LOWER(raw_topic.value) AS slug
        FROM "Room" AS room
        INNER JOIN "User" AS host ON host.id = room."hostId"
        CROSS JOIN LATERAL UNNEST(
          room.topics || CASE
            WHEN room.topic IS NULL THEN ARRAY[]::text[]
            ELSE ARRAY[room.topic]
          END
        ) AS raw_topic(value)
        WHERE room."isLive" = true
          AND room."isPrivate" = false
          AND room."roomType" = 'OPEN'
          AND room."endedAt" IS NULL
          AND host."deletedAt" IS NULL
          AND LOWER(raw_topic.value) IN (${Prisma.join(
            FLAT_TOPICS.map(topic => topic.slug.toLowerCase()),
          )})
      ) AS topic
      GROUP BY topic.slug
      ORDER BY count DESC, topic.slug ASC
      LIMIT 20
    `);
    const counts = new Map(rows.map(row => [row.slug, Number(row.count)]));
    const items = FLAT_TOPICS.map(tp => ({
      slug: tp.slug,
      label: tp.label,
      emoji: tp.emoji,
      count: counts.get(tp.slug.toLowerCase()) ?? 0,
    }))
      .filter(tp => tp.count > 0)
      .sort((a, b) => b.count - a.count)
      .slice(0, 20);
    res.json({ items, total: items.length });
  }),
);

const querySchema = z.object({
  q: z.string().min(1).max(64).optional(),
  parent: z.string().optional(),
});

topicsRouter.get(
  '/flat',
  asyncHandler(async (req, res) => {
    const { q, parent } = querySchema.parse(req.query);
    let results = FLAT_TOPICS;
    if (parent !== undefined) {
      results = results.filter(t => t.parent === (parent === 'null' ? null : parent));
    }
    if (q) {
      const needle = q.toLowerCase();
      results = results.filter(
        t => t.label.toLowerCase().includes(needle) || t.slug.includes(needle),
      );
    }
    res.json({ items: results, total: results.length });
  }),
);
