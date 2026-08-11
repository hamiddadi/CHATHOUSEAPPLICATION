-- Idempotent rollout repair for databases that may already have applied the
-- media lifecycle migration before rollback-writer compatibility was added.
-- Keeping this as a later migration ensures those databases receive the DB
-- default and trigger contract instead of relying on an edited checksum.
BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

ALTER TABLE "MediaObject"
ALTER COLUMN "uploadCompletedAt" SET DEFAULT CURRENT_TIMESTAMP;

CREATE OR REPLACE FUNCTION "chathouse_link_voice_media_object"()
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

  IF linked_media_id IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'voice media is unavailable for attachment';
  END IF;

  NEW."mediaObjectId" := linked_media_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "Message_link_voice_media_object" ON "Message";
CREATE TRIGGER "Message_link_voice_media_object"
BEFORE INSERT OR UPDATE OF "audioUrl", "kind", "senderId"
ON "Message"
FOR EACH ROW
EXECUTE FUNCTION "chathouse_link_voice_media_object"();

DROP TRIGGER IF EXISTS "GroupMessage_link_voice_media_object" ON "GroupMessage";
CREATE TRIGGER "GroupMessage_link_voice_media_object"
BEFORE INSERT OR UPDATE OF "audioUrl", "kind", "senderId"
ON "GroupMessage"
FOR EACH ROW
EXECUTE FUNCTION "chathouse_link_voice_media_object"();

COMMIT;
