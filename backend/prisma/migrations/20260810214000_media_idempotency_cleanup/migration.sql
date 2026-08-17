-- Make uploads replayable at one stable storage key and link voice media to
-- their durable message before enabling crash-recoverable orphan cleanup.
-- This migration backfills existing rows and takes ordinary index/FK locks.
-- Deployment stops API writers first; these bounds fail closed if an external
-- transaction still holds a conflicting lock or a single operation overruns
-- the remote deployment window.
BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30min';

ALTER TABLE "MediaObject"
-- Keep rollback images safe: legacy writers omit this new column after they
-- have already stored the bytes, while the metadata-first implementation
-- explicitly writes NULL until its PUT succeeds.
ADD COLUMN "uploadCompletedAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN "deletionClaimedAt" TIMESTAMP(3);

-- Every row created before metadata-first uploads already had its bytes stored
-- before the metadata insert. Treat all of those rows as complete; NULL remains
-- reserved for new uploads interrupted between metadata and object storage.
UPDATE "MediaObject"
SET "uploadCompletedAt" = "createdAt"
WHERE "uploadCompletedAt" IS NULL;

ALTER TABLE "Message"
ADD COLUMN "mediaObjectId" TEXT;

ALTER TABLE "GroupMessage"
ADD COLUMN "mediaObjectId" TEXT;

-- Existing signed capability URLs have the stable shape
-- /media/<MediaObject.id>/<signature>. Backfill only owner/kind matches so a
-- forged or legacy external URL can never acquire a private-media relation.
UPDATE "Message" AS message
SET "mediaObjectId" = media.id
FROM "MediaObject" AS media
WHERE message.kind = 'VOICE'
  AND message."senderId" = media."ownerId"
  AND media.kind = 'VOICE'
  AND substring(message."audioUrl" FROM '/media/([^/]+)/') = media.id;

UPDATE "GroupMessage" AS message
SET "mediaObjectId" = media.id
FROM "MediaObject" AS media
WHERE message.kind = 'VOICE'
  AND message."senderId" = media."ownerId"
  AND media.kind = 'VOICE'
  AND substring(message."audioUrl" FROM '/media/([^/]+)/') = media.id;

CREATE INDEX "MediaObject_kind_deletionClaimedAt_createdAt_idx"
ON "MediaObject"("kind", "deletionClaimedAt", "createdAt");

CREATE INDEX "Message_mediaObjectId_idx" ON "Message"("mediaObjectId");
CREATE INDEX "GroupMessage_mediaObjectId_idx" ON "GroupMessage"("mediaObjectId");

ALTER TABLE "Message"
ADD CONSTRAINT "Message_mediaObjectId_fkey"
FOREIGN KEY ("mediaObjectId") REFERENCES "MediaObject"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "GroupMessage"
ADD CONSTRAINT "GroupMessage_mediaObjectId_fkey"
FOREIGN KEY ("mediaObjectId") REFERENCES "MediaObject"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

-- A deployment may need to roll back to an image that predates mediaObjectId.
-- Maintain the relation in PostgreSQL so voice messages written by that image
-- remain protected from orphan cleanup when the new image is activated again.
-- The trigger deliberately requires the same owner/kind match as the backfill.
CREATE FUNCTION "chathouse_link_voice_media_object"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  requested_media_id TEXT;
  linked_media_id TEXT;
BEGIN
  IF NEW."kind" <> 'VOICE' OR NEW."audioUrl" IS NULL THEN
    NEW."mediaObjectId" := NULL;
    RETURN NEW;
  END IF;

  requested_media_id := substring(NEW."audioUrl" FROM '/media/([^/]+)/');
  SELECT media."id"
  INTO linked_media_id
  FROM "MediaObject" AS media
  WHERE media."id" = requested_media_id
    AND media."ownerId" = NEW."senderId"
    AND media."kind" = 'VOICE'
    AND media."uploadCompletedAt" IS NOT NULL
    AND media."deletionClaimedAt" IS NULL
  FOR NO KEY UPDATE;

  -- Serialize legacy INSERTs with the cleanup claim on the same row lock. If
  -- cleanup won, fail the message transaction instead of committing a broken
  -- audio URL after the object bytes have been selected for deletion.
  IF linked_media_id IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'voice media is unavailable for attachment';
  END IF;

  NEW."mediaObjectId" := linked_media_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "Message_link_voice_media_object"
BEFORE INSERT OR UPDATE OF "audioUrl", "kind", "senderId"
ON "Message"
FOR EACH ROW
EXECUTE FUNCTION "chathouse_link_voice_media_object"();

CREATE TRIGGER "GroupMessage_link_voice_media_object"
BEFORE INSERT OR UPDATE OF "audioUrl", "kind", "senderId"
ON "GroupMessage"
FOR EACH ROW
EXECUTE FUNCTION "chathouse_link_voice_media_object"();

COMMIT;
