-- Persist the exact Terms version accepted and the distinct acknowledgement
-- that the corresponding Privacy Notice was presented. Existing users remain
-- NULL and are therefore required to re-accept before publishing UGC.
ALTER TABLE "User"
  ADD COLUMN "termsAcceptedVersion" VARCHAR(32),
  ADD COLUMN "termsAcceptedAt" TIMESTAMP(3),
  ADD COLUMN "privacyNoticeAcknowledgedVersion" VARCHAR(32),
  ADD COLUMN "privacyNoticeAcknowledgedAt" TIMESTAMP(3),
  ADD COLUMN "legalAcceptanceLocale" VARCHAR(16);
