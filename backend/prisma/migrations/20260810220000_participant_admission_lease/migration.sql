BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

ALTER TABLE "Participant"
ADD COLUMN "admissionConfirmedAt" TIMESTAMP(3);

-- Existing active participants predate the socket-admission lease and must
-- never be mistaken for abandoned, unconfirmed joins after this deployment.
UPDATE "Participant"
SET "admissionConfirmedAt" = "joinedAt"
WHERE "leftAt" IS NULL;

CREATE INDEX "Participant_leftAt_admissionConfirmedAt_joinedAt_id_idx"
ON "Participant"("leftAt", "admissionConfirmedAt", "joinedAt", "id");

COMMIT;
