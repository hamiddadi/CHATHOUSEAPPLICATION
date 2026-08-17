BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Room.hostId is the sole host authority. Normalize legacy live-room rows
-- created before host hand-off demotion was enforced by the application.
UPDATE "Participant" AS participant
SET "role" = 'LISTENER',
    "isMuted" = TRUE
FROM "Room" AS room
WHERE participant."roomId" = room."id"
  AND room."isLive" = TRUE
  AND room."endedAt" IS NULL
  AND participant."role" = 'HOST'
  AND participant."userId" <> room."hostId";

-- Room moderator authority is scoped to one active presence. Normalize
-- voluntary/crash departures produced by older versions before re-entry.
UPDATE "Participant" AS participant
SET "role" = 'LISTENER',
    "isMuted" = TRUE
FROM "Room" AS room
WHERE participant."roomId" = room."id"
  AND room."isLive" = TRUE
  AND room."endedAt" IS NULL
  AND participant."leftAt" IS NOT NULL
  AND participant."role" = 'MODERATOR';

-- A RoomBan proves a punitive removal occurred. Old deployments only set
-- leftAt, which let an expired ban restore MODERATOR/SPEAKER privileges.
UPDATE "Participant" AS participant
SET "role" = 'LISTENER',
    "isMuted" = TRUE
FROM "RoomBan" AS ban
WHERE participant."roomId" = ban."roomId"
  AND participant."userId" = ban."userId"
  AND participant."role" IN ('HOST', 'MODERATOR', 'SPEAKER');

-- Repair the active authoritative host label last. This also handles a rare
-- legacy row that was demoted independently while Room.hostId stayed put.
UPDATE "Participant" AS participant
SET "role" = 'HOST'
FROM "Room" AS room
WHERE participant."roomId" = room."id"
  AND participant."userId" = room."hostId"
  AND participant."leftAt" IS NULL
  AND room."isLive" = TRUE
  AND room."endedAt" IS NULL
  AND participant."role" <> 'HOST';

COMMIT;
