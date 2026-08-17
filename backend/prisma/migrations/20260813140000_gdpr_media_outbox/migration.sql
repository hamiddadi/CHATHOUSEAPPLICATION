BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '10min';

-- Make an internal club cover a real SQL reference. Legacy/external cover URLs
-- intentionally remain valid with a NULL coverMediaObjectId; application code
-- links only HMAC-authenticated private-media references.
ALTER TABLE "ClubMetadata"
  ADD COLUMN IF NOT EXISTS "coverMediaObjectId" TEXT;

ALTER TABLE "Club"
  ADD COLUMN IF NOT EXISTS "iconMediaObjectId" TEXT;

CREATE INDEX IF NOT EXISTS "ClubMetadata_coverMediaObjectId_idx"
  ON "ClubMetadata"("coverMediaObjectId");
CREATE INDEX IF NOT EXISTS "Club_iconMediaObjectId_idx"
  ON "Club"("iconMediaObjectId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ClubMetadata_coverMediaObjectId_fkey'
      AND conrelid = '"ClubMetadata"'::regclass
  ) THEN
    ALTER TABLE "ClubMetadata"
      ADD CONSTRAINT "ClubMetadata_coverMediaObjectId_fkey"
      FOREIGN KEY ("coverMediaObjectId") REFERENCES "MediaObject"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'Club_iconMediaObjectId_fkey'
      AND conrelid = '"Club"'::regclass
  ) THEN
    ALTER TABLE "Club"
      ADD CONSTRAINT "Club_iconMediaObjectId_fkey"
      FOREIGN KEY ("iconMediaObjectId") REFERENCES "MediaObject"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$$;

-- ON DELETE SET NULL must not leave a routable-looking URL pointing at bytes
-- that no longer have authoritative metadata. External legacy covers already
-- have a NULL media id and are therefore unaffected.
CREATE OR REPLACE FUNCTION "chathouse_clear_unlinked_club_cover"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  referenced_media_id TEXT;
BEGIN
  referenced_media_id := COALESCE(
    substring(NEW."coverUrl" FROM '/media-ref/([^/]+)/'),
    substring(NEW."coverUrl" FROM '/media/([^/]+)/')
  );
  IF NEW."coverMediaObjectId" IS NOT NULL
     AND referenced_media_id IS DISTINCT FROM NEW."coverMediaObjectId" THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'club cover URL and media link must match';
  END IF;
  IF OLD."coverMediaObjectId" IS NOT NULL
     AND NEW."coverMediaObjectId" IS NULL THEN
    NEW."coverUrl" := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "ClubMetadata_clear_unlinked_cover" ON "ClubMetadata";
CREATE TRIGGER "ClubMetadata_clear_unlinked_cover"
BEFORE UPDATE OF "coverMediaObjectId", "coverUrl" ON "ClubMetadata"
FOR EACH ROW
EXECUTE FUNCTION "chathouse_clear_unlinked_club_cover"();

CREATE OR REPLACE FUNCTION "chathouse_clear_unlinked_club_icon"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  referenced_media_id TEXT;
BEGIN
  referenced_media_id := COALESCE(
    substring(NEW."iconUrl" FROM '/media-ref/([^/]+)/'),
    substring(NEW."iconUrl" FROM '/media/([^/]+)/')
  );
  IF NEW."iconMediaObjectId" IS NOT NULL
     AND referenced_media_id IS DISTINCT FROM NEW."iconMediaObjectId" THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'club icon URL and media link must match';
  END IF;
  IF OLD."iconMediaObjectId" IS NOT NULL
     AND NEW."iconMediaObjectId" IS NULL THEN
    NEW."iconUrl" := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "Club_clear_unlinked_icon" ON "Club";
CREATE TRIGGER "Club_clear_unlinked_icon"
BEFORE UPDATE OF "iconMediaObjectId", "iconUrl" ON "Club"
FOR EACH ROW
EXECUTE FUNCTION "chathouse_clear_unlinked_club_icon"();

CREATE OR REPLACE FUNCTION "chathouse_clear_unlinked_report_media"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD."contentMediaObjectId" IS NOT NULL
     AND NEW."contentMediaObjectId" IS NULL THEN
    NEW."contentAudioUrl" := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "Report_clear_unlinked_media" ON "Report";
CREATE TRIGGER "Report_clear_unlinked_media"
BEFORE UPDATE OF "contentMediaObjectId" ON "Report"
FOR EACH ROW
EXECUTE FUNCTION "chathouse_clear_unlinked_report_media"();

COMMIT;
