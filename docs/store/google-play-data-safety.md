# Google Play — Data Safety form (answer sheet)

Fill this into **Play Console → App content → Data safety**. It is the
source-of-truth answer sheet derived from the application and Prisma schema.
No advertising SDK or cross-app tracking is present. Console submission remains
a manual release-gate action; this file cannot update Play Console by itself.

## Overview answers

- **Does your app collect or share any of the required user data types?** Yes
- **Is all data encrypted in transit?** Yes (HTTPS/WSS via the Caddy TLS proxy — see `backend/Caddyfile`)
- **Do you provide a way for users to request data deletion?** Yes — in-app
  (Settings → Privacy → Delete my account) and through the public
  `https://api.chathouse.app/account-deletion` resource. The account is disabled
  immediately, can be restored by login for 30 days, then is purged.

## Data types — Collected / Shared / Purpose

"Shared" uses Google Play's definition. Transfers to a contracted service
provider acting only on Chathouse's instructions are **not** marked as sharing.
Confirm the provider contracts/DPA before submission; if any provider may use
data for its own purposes, change that row to Shared = Yes.

| Category               | Data type                     | Collected | Shared | Service provider(s)             | Purpose                               | Optional? |
| ---------------------- | ----------------------------- | --------- | ------ | ------------------------------- | ------------------------------------- | --------- |
| Personal info          | Name                          | Yes       | No     | Hosting                         | App functionality, account management | Optional  |
| Personal info          | Email address                 | Yes       | No     | Hosting                         | Account management                    | Optional  |
| Personal info          | Phone number                  | Yes       | No     | Hosting, Twilio                 | Authentication, account management    | Required  |
| Personal info          | User IDs                      | Yes       | No     | Hosting, Stripe                 | App functionality, account, fraud     | Required  |
| Personal info          | Other info (bio/social links) | Yes       | No     | Hosting                         | App functionality, personalization    | Optional  |
| Location               | Approximate location          | Yes       | No     | Hosting                         | App functionality, personalization    | Optional  |
| Location               | Precise location              | Yes       | No     | Hosting                         | App functionality, personalization    | Optional  |
| Financial info         | Purchase history              | Yes       | No     | Stripe                          | App functionality, fraud/compliance   | Optional  |
| Photos and videos      | Photos                        | Yes       | No     | Private object storage          | App functionality                     | Optional  |
| Audio files            | Voice or sound recordings     | Yes       | No     | LiveKit, private object storage | App functionality                     | Optional  |
| Messages               | Other in-app messages         | Yes       | No     | Hosting, private object storage | App functionality                     | Optional  |
| App activity           | App interactions              | Yes       | No     | Hosting                         | App functionality, personalization    | Required  |
| App activity           | Other user-generated content  | Yes       | No     | Hosting                         | App functionality, moderation         | Optional  |
| App info & performance | Crash logs                    | Yes       | No     | Sentry                          | Analytics/diagnostics                 | Optional  |
| App info & performance | Diagnostics                   | Yes       | No     | Sentry                          | Analytics/diagnostics                 | Optional  |
| Device or other IDs    | Device or other IDs           | Yes       | No     | Firebase/FCM and APNs           | App functionality (notifications)     | Optional  |

> Note on "Financial info": the app never stores card data — Stripe Checkout
> handles card entry. Declare only **purchase history**, processed by Stripe.

> Mobile Sentry collection is disabled by default and requires explicit,
> revocable consent. Room recording/replays are disabled; the audio declaration
> remains because voice messages may be stored and live audio is transported.

## Security practices to tick

- Encrypted in transit: **Yes**
- Users can request data deletion: **Yes**
- Committed to the Play Families Policy: N/A unless you target children (you don't)
- Independent security review: optional (leave unticked unless you have one)

## Release gate

Before moving beyond internal testing, verify the two public URLs return 200,
submit this exact inventory in Play Console, and compare it with Play's SDK
Index declarations for every shipped SDK. Do not claim an independent security
review until one has actually been completed.
