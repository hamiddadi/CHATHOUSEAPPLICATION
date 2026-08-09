-- Persist Stripe's own ordering metadata so a delayed/replayed webhook cannot
-- overwrite a newer subscription state after the short-lived Redis claim has
-- expired. All columns are nullable for a safe rolling deployment; existing
-- rows are hydrated from the next verified Stripe subscription object.
ALTER TABLE "Subscription"
  ADD COLUMN "stripeSubscriptionCreatedAt" TIMESTAMP(3),
  ADD COLUMN "lastStripeEventCreatedAt" TIMESTAMP(3),
  ADD COLUMN "lastStripeEventId" VARCHAR(255);
