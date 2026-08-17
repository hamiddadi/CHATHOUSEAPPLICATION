BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30min';

CREATE TABLE IF NOT EXISTS "DeploymentCutover" (
  "key" VARCHAR(100) NOT NULL,
  "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "details" JSONB,
  CONSTRAINT "DeploymentCutover_pkey" PRIMARY KEY ("key")
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AudioQualityTier') THEN
    CREATE TYPE "AudioQualityTier" AS ENUM ('STANDARD', 'HIGH', 'MUSIC');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'DropInMode') THEN
    CREATE TYPE "DropInMode" AS ENUM ('SILENT', 'NORMAL');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'NotificationFrequencyTier') THEN
    CREATE TYPE "NotificationFrequencyTier" AS ENUM ('INFREQUENT', 'NORMAL', 'FREQUENT');
  END IF;
END
$$;

ALTER TABLE "Notification"
  ADD COLUMN IF NOT EXISTS "dedupeKey" VARCHAR(191);

ALTER TABLE "Report"
  ADD COLUMN IF NOT EXISTS "contentMediaObjectId" TEXT;

CREATE INDEX IF NOT EXISTS "Report_contentMediaObjectId_idx"
  ON "Report"("contentMediaObjectId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'Report_contentMediaObjectId_fkey'
  ) THEN
    ALTER TABLE "Report"
      ADD CONSTRAINT "Report_contentMediaObjectId_fkey"
      FOREIGN KEY ("contentMediaObjectId") REFERENCES "MediaObject"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$$;

-- Do not infer this relation from an unauthenticated URL substring here. An
-- external URL can legitimately contain `/media/<existing-id>/` and must not
-- be linked to a private object. The post-migration cutover verifies the HMAC,
-- origin, media kind and owner, then writes the URL and FK atomically.

ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "allowContactDiscovery" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS "User_contact_discovery_idx"
  ON "User"("allowContactDiscovery", "phoneNumber");
CREATE INDEX IF NOT EXISTS "User_contact_discovery_phone_opted_in_idx"
  ON "User"("phoneNumber")
  WHERE "allowContactDiscovery" = true AND "phoneNumber" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "Notification_dedupeKey_key"
  ON "Notification"("dedupeKey");

-- Usernames are canonical lowercase in every write path. Abort with a clear
-- diagnostic instead of silently renaming an account if legacy case variants
-- would collapse to the same handle.
DO $$
BEGIN
  IF EXISTS (
    SELECT lower("username")
    FROM "User"
    WHERE "username" IS NOT NULL
    GROUP BY lower("username")
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'cannot normalize usernames: case-insensitive duplicates exist'
      USING ERRCODE = '23505';
  END IF;
END
$$;

UPDATE "User"
SET "username" = lower("username"), "updatedAt" = CURRENT_TIMESTAMP
WHERE "username" IS NOT NULL AND "username" <> lower("username");

CREATE UNIQUE INDEX IF NOT EXISTS "User_username_lower_key"
  ON "User" (lower("username"))
  WHERE "username" IS NOT NULL;

CREATE TABLE IF NOT EXISTS "ProfileLink" (
  "id" VARCHAR(64) NOT NULL,
  "userId" TEXT NOT NULL,
  "label" VARCHAR(40) NOT NULL,
  "url" VARCHAR(500) NOT NULL,
  "icon" VARCHAR(16),
  "position" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProfileLink_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProfileLink_userId_fkey" FOREIGN KEY ("userId")
    REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "ProfileLink_userId_position_key"
  ON "ProfileLink"("userId", "position");
CREATE INDEX IF NOT EXISTS "ProfileLink_userId_createdAt_idx"
  ON "ProfileLink"("userId", "createdAt");

CREATE TABLE IF NOT EXISTS "UserAudioPreference" (
  "userId" TEXT NOT NULL,
  "qualityTier" "AudioQualityTier" NOT NULL DEFAULT 'STANDARD',
  "spatialAudio" BOOLEAN NOT NULL DEFAULT false,
  "noiseSuppression" BOOLEAN NOT NULL DEFAULT true,
  "dropInMode" "DropInMode" NOT NULL DEFAULT 'NORMAL',
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "UserAudioPreference_pkey" PRIMARY KEY ("userId"),
  CONSTRAINT "UserAudioPreference_userId_fkey" FOREIGN KEY ("userId")
    REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "UserNotificationExtensionPreference" (
  "userId" TEXT NOT NULL,
  "frequency" "NotificationFrequencyTier" NOT NULL DEFAULT 'NORMAL',
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "UserNotificationExtensionPreference_pkey" PRIMARY KEY ("userId"),
  CONSTRAINT "UserNotificationExtensionPreference_userId_fkey" FOREIGN KEY ("userId")
    REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "NotificationClubMute" (
  "userId" TEXT NOT NULL,
  "clubId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NotificationClubMute_pkey" PRIMARY KEY ("userId", "clubId"),
  CONSTRAINT "NotificationClubMute_userId_fkey" FOREIGN KEY ("userId")
    REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "NotificationClubMute_clubId_fkey" FOREIGN KEY ("clubId")
    REFERENCES "Club"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "NotificationClubMute_clubId_idx"
  ON "NotificationClubMute"("clubId");

CREATE TABLE IF NOT EXISTS "NotificationUserMute" (
  "userId" TEXT NOT NULL,
  "mutedUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NotificationUserMute_pkey" PRIMARY KEY ("userId", "mutedUserId"),
  CONSTRAINT "NotificationUserMute_userId_fkey" FOREIGN KEY ("userId")
    REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "NotificationUserMute_mutedUserId_fkey" FOREIGN KEY ("mutedUserId")
    REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "NotificationUserMute_not_self_check" CHECK ("userId" <> "mutedUserId")
);

CREATE INDEX IF NOT EXISTS "NotificationUserMute_mutedUserId_idx"
  ON "NotificationUserMute"("mutedUserId");

CREATE TABLE IF NOT EXISTS "UserExtensionImport" (
  "userId" TEXT NOT NULL,
  "namespace" VARCHAR(64) NOT NULL,
  "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UserExtensionImport_pkey" PRIMARY KEY ("userId", "namespace"),
  CONSTRAINT "UserExtensionImport_userId_fkey" FOREIGN KEY ("userId")
    REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "ClubMetadata" (
  "clubId" TEXT NOT NULL,
  "coverUrl" VARCHAR(500),
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ClubMetadata_pkey" PRIMARY KEY ("clubId"),
  CONSTRAINT "ClubMetadata_clubId_fkey" FOREIGN KEY ("clubId")
    REFERENCES "Club"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "ClubFeaturedMember" (
  "clubId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "featuredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ClubFeaturedMember_pkey" PRIMARY KEY ("clubId", "userId"),
  CONSTRAINT "ClubFeaturedMember_clubId_fkey" FOREIGN KEY ("clubId")
    REFERENCES "Club"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ClubFeaturedMember_userId_fkey" FOREIGN KEY ("userId")
    REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  -- Being featured is a property of a current membership, not a durable user
  -- association. Cascading this composite FK prevents departed/removed users
  -- from remaining in the club's featured roster.
  CONSTRAINT "ClubFeaturedMember_membership_fkey" FOREIGN KEY ("clubId", "userId")
    REFERENCES "ClubMember"("clubId", "userId") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "ClubFeaturedMember_clubId_featuredAt_idx"
  ON "ClubFeaturedMember"("clubId", "featuredAt");
CREATE INDEX IF NOT EXISTS "ClubFeaturedMember_userId_idx"
  ON "ClubFeaturedMember"("userId");

CREATE TABLE IF NOT EXISTS "ClubExtensionImport" (
  "clubId" TEXT NOT NULL,
  "namespace" VARCHAR(64) NOT NULL,
  "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ClubExtensionImport_pkey" PRIMARY KEY ("clubId", "namespace"),
  CONSTRAINT "ClubExtensionImport_clubId_fkey" FOREIGN KEY ("clubId")
    REFERENCES "Club"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "RoomReaction_userId_createdAt_idx"
  ON "RoomReaction"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "RoomBan_bannedBy_createdAt_idx"
  ON "RoomBan"("bannedBy", "createdAt");

-- Repair simple legacy values before validating constraints that are safe to
-- normalize without changing user-authored content or financial history.
UPDATE "User"
SET "followerCount" = GREATEST("followerCount", 0),
    "followingCount" = GREATEST("followingCount", 0),
    "invitesRemaining" = GREATEST("invitesRemaining", 0)
WHERE "followerCount" < 0 OR "followingCount" < 0 OR "invitesRemaining" < 0;

UPDATE "User"
SET "latitude" = NULL, "longitude" = NULL
WHERE ("latitude" IS NULL) <> ("longitude" IS NULL)
   OR "latitude" NOT BETWEEN -90 AND 90
   OR "longitude" NOT BETWEEN -180 AND 180;

UPDATE "User"
SET "dmPrivacy" = 'mutual'
WHERE "dmPrivacy" NOT IN ('everyone', 'followers', 'mutual', 'nobody');

UPDATE "Room"
SET "maxSpeakers" = GREATEST("maxSpeakers", 1),
    "participantCount" = GREATEST("participantCount", 0),
    "totalAttendees" = GREATEST("totalAttendees", 0)
WHERE "maxSpeakers" < 1 OR "participantCount" < 0 OR "totalAttendees" < 0;

-- Rebuild denormalized social/member counts from their relational source of
-- truth before enabling non-negative checks.
UPDATE "User" AS u
SET "followerCount" = (
      SELECT count(*)::integer FROM "Follow" f
      WHERE f."followingId" = u."id" AND f."status" = 'ACCEPTED'
    ),
    "followingCount" = (
      SELECT count(*)::integer FROM "Follow" f
      WHERE f."followerId" = u."id" AND f."status" = 'ACCEPTED'
    );

UPDATE "Club" AS c
SET "memberCount" = (
  SELECT count(*)::integer FROM "ClubMember" cm WHERE cm."clubId" = c."id"
);

ALTER TABLE "User"
  DROP CONSTRAINT IF EXISTS "User_social_counts_nonnegative_check",
  DROP CONSTRAINT IF EXISTS "User_invites_nonnegative_check",
  DROP CONSTRAINT IF EXISTS "User_coordinates_check",
  DROP CONSTRAINT IF EXISTS "User_dm_privacy_check",
  DROP CONSTRAINT IF EXISTS "User_username_lowercase_check";

ALTER TABLE "User"
  ADD CONSTRAINT "User_social_counts_nonnegative_check"
    CHECK ("followerCount" >= 0 AND "followingCount" >= 0) NOT VALID,
  ADD CONSTRAINT "User_invites_nonnegative_check"
    CHECK ("invitesRemaining" >= 0) NOT VALID,
  ADD CONSTRAINT "User_coordinates_check"
    CHECK (("latitude" IS NULL AND "longitude" IS NULL) OR
           ("latitude" BETWEEN -90 AND 90 AND "longitude" BETWEEN -180 AND 180)) NOT VALID,
  ADD CONSTRAINT "User_dm_privacy_check"
    CHECK ("dmPrivacy" IN ('everyone', 'followers', 'mutual', 'nobody')) NOT VALID,
  ADD CONSTRAINT "User_username_lowercase_check"
    CHECK ("username" IS NULL OR "username" = lower("username")) NOT VALID;

ALTER TABLE "User" VALIDATE CONSTRAINT "User_social_counts_nonnegative_check";
ALTER TABLE "User" VALIDATE CONSTRAINT "User_invites_nonnegative_check";
ALTER TABLE "User" VALIDATE CONSTRAINT "User_coordinates_check";
ALTER TABLE "User" VALIDATE CONSTRAINT "User_dm_privacy_check";
ALTER TABLE "User" VALIDATE CONSTRAINT "User_username_lowercase_check";

ALTER TABLE "Club"
  DROP CONSTRAINT IF EXISTS "Club_member_count_nonnegative_check";
ALTER TABLE "Club"
  ADD CONSTRAINT "Club_member_count_nonnegative_check"
    CHECK ("memberCount" >= 0) NOT VALID;
ALTER TABLE "Club" VALIDATE CONSTRAINT "Club_member_count_nonnegative_check";

ALTER TABLE "Room"
  DROP CONSTRAINT IF EXISTS "Room_counts_nonnegative_check",
  DROP CONSTRAINT IF EXISTS "Room_cancellation_terminal_check";
ALTER TABLE "Room"
  ADD CONSTRAINT "Room_counts_nonnegative_check"
    CHECK ("maxSpeakers" >= 1 AND "participantCount" >= 0 AND "totalAttendees" >= 0) NOT VALID,
  ADD CONSTRAINT "Room_cancellation_terminal_check"
    CHECK ("canceledAt" IS NULL OR "endedAt" IS NOT NULL) NOT VALID;
ALTER TABLE "Room" VALIDATE CONSTRAINT "Room_counts_nonnegative_check";

ALTER TABLE "ProfileLink"
  DROP CONSTRAINT IF EXISTS "ProfileLink_position_nonnegative_check";
ALTER TABLE "ProfileLink"
  ADD CONSTRAINT "ProfileLink_position_nonnegative_check" CHECK ("position" >= 0);
ALTER TABLE "Tip"
  DROP CONSTRAINT IF EXISTS "Tip_amount_positive_check",
  DROP CONSTRAINT IF EXISTS "Tip_currency_iso_check";
ALTER TABLE "Tip"
  ADD CONSTRAINT "Tip_amount_positive_check" CHECK ("amount" > 0) NOT VALID,
  ADD CONSTRAINT "Tip_currency_iso_check" CHECK ("currency" ~ '^[a-z]{3}$') NOT VALID;

-- These payload checks immediately protect new writes. They remain NOT VALID
-- so a pre-existing malformed row cannot turn an otherwise additive deploy
-- into an outage; the reconciliation query can be reviewed before validation.
ALTER TABLE "Message"
  DROP CONSTRAINT IF EXISTS "Message_target_check",
  DROP CONSTRAINT IF EXISTS "Message_payload_check";
ALTER TABLE "Message"
  ADD CONSTRAINT "Message_target_check"
    CHECK (("roomId" IS NOT NULL)::integer + ("receiverId" IS NOT NULL)::integer = 1) NOT VALID,
  ADD CONSTRAINT "Message_payload_check"
    CHECK (("kind" = 'TEXT' AND "content" IS NOT NULL AND "audioUrl" IS NULL AND "audioDurationMs" IS NULL)
        OR ("kind" = 'VOICE' AND "content" IS NULL AND "audioUrl" IS NOT NULL AND "audioDurationMs" > 0)) NOT VALID;

ALTER TABLE "GroupMessage"
  DROP CONSTRAINT IF EXISTS "GroupMessage_payload_check";
ALTER TABLE "GroupMessage"
  ADD CONSTRAINT "GroupMessage_payload_check"
    CHECK (("kind" = 'TEXT' AND "content" IS NOT NULL AND "audioUrl" IS NULL AND "audioDurationMs" IS NULL)
        OR ("kind" = 'VOICE' AND "content" IS NULL AND "audioUrl" IS NOT NULL AND "audioDurationMs" > 0)) NOT VALID;

-- Deferred authority invariants allow create/transfer transactions to update
-- the parent and membership rows in either order while rejecting a bad commit.
UPDATE "ClubMember" AS cm
SET "role" = 'ADMIN'
FROM "Club" AS c
WHERE cm."clubId" = c."id" AND cm."userId" = c."ownerId" AND cm."role" <> 'ADMIN';

INSERT INTO "ClubMember" ("id", "clubId", "userId", "role", "joinedAt")
SELECT concat('repair_', md5(c."id" || ':' || c."ownerId")),
       c."id", c."ownerId", 'ADMIN', c."createdAt"
FROM "Club" AS c
WHERE NOT EXISTS (
  SELECT 1 FROM "ClubMember" cm
  WHERE cm."clubId" = c."id" AND cm."userId" = c."ownerId"
)
ON CONFLICT ("clubId", "userId") DO UPDATE SET "role" = 'ADMIN';

UPDATE "Club" AS c
SET "memberCount" = (
  SELECT count(*)::integer FROM "ClubMember" cm WHERE cm."clubId" = c."id"
);

INSERT INTO "ConversationMember" ("id", "conversationId", "userId", "joinedAt")
SELECT concat('repair_', md5(c."id" || ':' || c."ownerId")),
       c."id", c."ownerId", c."createdAt"
FROM "Conversation" AS c
WHERE NOT EXISTS (
  SELECT 1 FROM "ConversationMember" cm
  WHERE cm."conversationId" = c."id" AND cm."userId" = c."ownerId"
)
ON CONFLICT ("conversationId", "userId") DO NOTHING;

CREATE OR REPLACE FUNCTION "check_club_owner_membership"() RETURNS trigger AS $$
DECLARE
  checked_club_id TEXT;
  checked_club_ids TEXT[];
BEGIN
  IF TG_TABLE_NAME = 'Club' THEN
    checked_club_ids := ARRAY[
      CASE WHEN TG_OP = 'DELETE' THEN OLD."id" ELSE NEW."id" END
    ];
  ELSIF TG_OP = 'UPDATE' THEN
    -- A relation-row move can invalidate both parents. Checking only NEW
    -- leaves the old club without its owner membership after a clubId change.
    checked_club_ids := ARRAY[OLD."clubId", NEW."clubId"];
  ELSE
    checked_club_ids := ARRAY[
      CASE WHEN TG_OP = 'DELETE' THEN OLD."clubId" ELSE NEW."clubId" END
    ];
  END IF;

  FOREACH checked_club_id IN ARRAY checked_club_ids LOOP
    IF EXISTS (SELECT 1 FROM "Club" c WHERE c."id" = checked_club_id)
       AND NOT EXISTS (
         SELECT 1 FROM "Club" c
         JOIN "ClubMember" cm ON cm."clubId" = c."id" AND cm."userId" = c."ownerId"
         WHERE c."id" = checked_club_id AND cm."role" = 'ADMIN'
       ) THEN
      RAISE EXCEPTION 'club owner must remain an ADMIN member' USING ERRCODE = '23514';
    END IF;
  END LOOP;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "Club_owner_membership_check" ON "Club";
CREATE CONSTRAINT TRIGGER "Club_owner_membership_check"
AFTER INSERT OR UPDATE OF "ownerId" ON "Club"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "check_club_owner_membership"();

DROP TRIGGER IF EXISTS "ClubMember_owner_membership_check" ON "ClubMember";
CREATE CONSTRAINT TRIGGER "ClubMember_owner_membership_check"
AFTER INSERT OR UPDATE OR DELETE ON "ClubMember"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "check_club_owner_membership"();

CREATE OR REPLACE FUNCTION "check_conversation_owner_membership"() RETURNS trigger AS $$
DECLARE
  checked_conversation_id TEXT;
  checked_conversation_ids TEXT[];
BEGIN
  IF TG_TABLE_NAME = 'Conversation' THEN
    checked_conversation_ids := ARRAY[
      CASE WHEN TG_OP = 'DELETE' THEN OLD."id" ELSE NEW."id" END
    ];
  ELSIF TG_OP = 'UPDATE' THEN
    checked_conversation_ids := ARRAY[OLD."conversationId", NEW."conversationId"];
  ELSE
    checked_conversation_ids := ARRAY[
      CASE WHEN TG_OP = 'DELETE' THEN OLD."conversationId" ELSE NEW."conversationId" END
    ];
  END IF;

  FOREACH checked_conversation_id IN ARRAY checked_conversation_ids LOOP
    IF EXISTS (SELECT 1 FROM "Conversation" c WHERE c."id" = checked_conversation_id)
       AND NOT EXISTS (
         SELECT 1 FROM "Conversation" c
         JOIN "ConversationMember" cm
           ON cm."conversationId" = c."id" AND cm."userId" = c."ownerId"
         WHERE c."id" = checked_conversation_id
       ) THEN
      RAISE EXCEPTION 'conversation owner must remain a member' USING ERRCODE = '23514';
    END IF;
  END LOOP;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "Conversation_owner_membership_check" ON "Conversation";
CREATE CONSTRAINT TRIGGER "Conversation_owner_membership_check"
AFTER INSERT OR UPDATE OF "ownerId" ON "Conversation"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "check_conversation_owner_membership"();

DROP TRIGGER IF EXISTS "ConversationMember_owner_membership_check" ON "ConversationMember";
CREATE CONSTRAINT TRIGGER "ConversationMember_owner_membership_check"
AFTER INSERT OR UPDATE OR DELETE ON "ConversationMember"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "check_conversation_owner_membership"();

-- The private-media writer now persists a non-routable `/media-ref/:id/*`
-- reference. Keep accepting `/media/:id/*` so an older application image can
-- still write safely during a rolling deployment or rollback window.
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

  requested_media_id := COALESCE(
    substring(NEW."audioUrl" FROM '/media-ref/([^/]+)/'),
    substring(NEW."audioUrl" FROM '/media/([^/]+)/')
  );
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

COMMIT;
