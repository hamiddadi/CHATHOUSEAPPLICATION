import { prisma } from './database';
import { logger } from './logger';

/**
 * Idempotent search-index bootstrap. Ensures the pg_trgm extension is
 * installed and that GIN trigram indexes exist on the columns our /search
 * and /explore endpoints filter on. Safe to call on every boot — each
 * CREATE uses IF NOT EXISTS.
 *
 * We use pg_trgm instead of a tsvector column because (a) our queries are
 * substring-focused ("ama", "tech") not natural-language phrase search,
 * and (b) it avoids the maintenance cost of triggers keeping tsvector in
 * sync with edits. If we ever need phrase/ranked search we can layer
 * tsvector on top without touching the trigram indexes.
 */
export const ensureSearchIndexes = async (): Promise<void> => {
  try {
    await prisma.$executeRawUnsafe('CREATE EXTENSION IF NOT EXISTS pg_trgm');

    const statements = [
      `CREATE INDEX IF NOT EXISTS "user_username_trgm" ON "User" USING gin ("username" gin_trgm_ops)`,
      `CREATE INDEX IF NOT EXISTS "user_displayName_trgm" ON "User" USING gin ("displayName" gin_trgm_ops)`,
      `CREATE INDEX IF NOT EXISTS "user_bio_trgm" ON "User" USING gin ("bio" gin_trgm_ops)`,
      `CREATE INDEX IF NOT EXISTS "club_name_trgm" ON "Club" USING gin ("name" gin_trgm_ops)`,
      `CREATE INDEX IF NOT EXISTS "club_description_trgm" ON "Club" USING gin ("description" gin_trgm_ops)`,
      `CREATE INDEX IF NOT EXISTS "room_title_trgm" ON "Room" USING gin ("title" gin_trgm_ops)`,
      `CREATE INDEX IF NOT EXISTS "room_topic_trgm" ON "Room" USING gin ("topic" gin_trgm_ops)`,
    ];
    for (const stmt of statements) {
      await prisma.$executeRawUnsafe(stmt);
    }
    logger.info('search indexes ensured (pg_trgm)');
  } catch (err) {
    logger.error('ensureSearchIndexes failed', {
      err: err instanceof Error ? err.message : err,
    });
  }
};
