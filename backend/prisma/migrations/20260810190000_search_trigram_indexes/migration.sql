-- Search DDL belongs to the controlled migration path, never to API startup.
-- Prisma runs PostgreSQL migrations transactionally in this deployment. These
-- fail-fast lock settings avoid waiting behind unexpected writers; the deploy
-- orchestrator stops the API for this one migration because a normal GIN index
-- build holds a write-conflicting lock until the transaction commits.
BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30min';

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;

CREATE INDEX IF NOT EXISTS "user_username_trgm"
  ON "User" USING gin ("username" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "user_displayName_trgm"
  ON "User" USING gin ("displayName" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "user_bio_trgm"
  ON "User" USING gin ("bio" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "club_name_trgm"
  ON "Club" USING gin ("name" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "club_description_trgm"
  ON "Club" USING gin ("description" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "room_title_trgm"
  ON "Room" USING gin ("title" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "room_topic_trgm"
  ON "Room" USING gin ("topic" gin_trgm_ops);

COMMIT;
