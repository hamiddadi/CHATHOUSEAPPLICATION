-- Stripe Connect payout accounts are financial state and must survive Redis
-- eviction/restarts. Redis remains a cache for the current KYC flags only.
ALTER TABLE "User" ADD COLUMN "stripeConnectAccountId" TEXT;

CREATE UNIQUE INDEX "User_stripeConnectAccountId_key"
ON "User"("stripeConnectAccountId");
