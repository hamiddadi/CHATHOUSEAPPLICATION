-- Supports the stable newest-activity ordering used by cursor-paginated group lists.
-- CREATE INDEX takes a write-blocking table lock, so the deployment guard
-- treats this migration as maintenance-only and these local bounds prevent an
-- unexpected lock holder from consuming the entire remote deployment window.
BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30min';

CREATE INDEX "Conversation_updatedAt_id_idx" ON "Conversation"("updatedAt", "id");

COMMIT;
