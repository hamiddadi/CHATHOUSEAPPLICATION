-- Generic transactional outbox. Consumers are intentionally decoupled from
-- domain tables so the same mechanism can later serve chat/group events.
BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

CREATE TYPE "OutboxEventStatus" AS ENUM ('PENDING', 'PROCESSING', 'DELIVERED');

CREATE TABLE "OutboxEvent" (
    "id" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "topic" VARCHAR(100) NOT NULL,
    "aggregateId" TEXT,
    "payload" JSONB NOT NULL,
    "status" "OutboxEventStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "lastError" VARCHAR(1000),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OutboxEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OutboxEvent_eventKey_key" ON "OutboxEvent"("eventKey");
CREATE INDEX "OutboxEvent_status_availableAt_claimedAt_idx"
  ON "OutboxEvent"("status", "availableAt", "claimedAt");
CREATE INDEX "OutboxEvent_topic_aggregateId_deliveredAt_idx"
  ON "OutboxEvent"("topic", "aggregateId", "deliveredAt");
CREATE INDEX "OutboxEvent_deliveredAt_idx" ON "OutboxEvent"("deliveredAt");

COMMIT;
