import { Router } from 'express';
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
    const rooms = await prisma.room.findMany({
      where: { isLive: true, isPrivate: false, endedAt: null },
      select: { topic: true, topics: true },
    });
    const counts = new Map<string, number>();
    for (const r of rooms) {
      const slugs = new Set<string>();
      for (const tp of r.topics ?? []) slugs.add(tp.toLowerCase());
      if (r.topic) slugs.add(r.topic.toLowerCase());
      for (const s of slugs) counts.set(s, (counts.get(s) ?? 0) + 1);
    }
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
