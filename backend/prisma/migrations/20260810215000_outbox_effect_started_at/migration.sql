BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

ALTER TABLE "OutboxEvent"
ADD COLUMN "effectStartedAt" TIMESTAMP(3);

COMMIT;
