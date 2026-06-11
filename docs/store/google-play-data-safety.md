# Google Play — Data Safety form (answer sheet)

Fill this into **Play Console → App content → Data safety**. Derived from what the
Chathouse code actually collects (Prisma `User` model, OTP/phone auth, maps
location, voice/live audio, Stripe tips, Sentry diagnostics, Expo push tokens).
No advertising SDKs and no cross-app tracking are present.

## Overview answers

- **Does your app collect or share any of the required user data types?** Yes
- **Is all data encrypted in transit?** Yes (HTTPS/WSS via the Caddy TLS proxy — see `backend/Caddyfile`)
- **Do you provide a way for users to request data deletion?** Yes — in-app
  (Settings → Delete account, `DeleteAccountScreen`) **and** via account-deletion
  request endpoint, with a 30-day purge worker. Also data export (GDPR).

## Data types — Collected / Shared / Purpose

"Shared" = sent to a third party that processes it. Processors used: **Stripe**
(payments), **Sentry** (diagnostics), **LiveKit** (live audio transport),
**Expo** (push delivery). All processing is for app functionality — never ads.

| Category               | Data type                    | Collected | Shared (processor)  | Purpose                                     | Optional?          |
| ---------------------- | ---------------------------- | --------- | ------------------- | ------------------------------------------- | ------------------ |
| Personal info          | Name                         | Yes       | No                  | App functionality, Account                  | Required           |
| Personal info          | Email address                | Yes       | No                  | Account, Account management                 | Required           |
| Personal info          | Phone number                 | Yes       | No                  | Account (OTP sign-in)                       | Required           |
| Personal info          | User IDs                     | Yes       | Sentry, Stripe      | App functionality, Analytics(diag)          | Required           |
| Personal info          | Other (bio, social handles)  | Yes       | No                  | App functionality (profile)                 | Optional           |
| Location               | Approximate location         | Yes       | No                  | App functionality (nearby rooms/map)        | Optional           |
| Location               | Precise location             | Yes       | No                  | App functionality (map)                     | Optional           |
| Financial info         | Purchase history             | Yes       | Stripe              | App functionality (tips/premium)            | Optional           |
| Photos and videos      | Photos                       | Yes       | No                  | App functionality (profile photo)           | Optional           |
| Audio                  | Voice or sound recordings    | Yes       | LiveKit (transport) | App functionality (audio rooms, voice msgs) | Required for audio |
| Messages               | Other in-app messages        | Yes       | No                  | App functionality (DMs, room chat)          | Optional           |
| App activity           | App interactions             | Yes       | No                  | App functionality                           | Required           |
| App activity           | Other user-generated content | Yes       | No                  | App functionality (rooms/follows/reactions) | Optional           |
| App info & performance | Crash logs                   | Yes       | Sentry              | Diagnostics                                 | Optional           |
| App info & performance | Diagnostics                  | Yes       | Sentry              | Diagnostics                                 | Optional           |
| Device or other IDs    | Device or other IDs          | Yes       | Expo (push)         | App functionality (notifications)           | Optional           |

> Note on "Financial info": the app never stores card data — Stripe Checkout
> handles card entry. Declare only **purchase history**, processed by Stripe.

## Security practices to tick

- Encrypted in transit: **Yes**
- Users can request data deletion: **Yes**
- Committed to the Play Families Policy: N/A unless you target children (you don't)
- Independent security review: optional (leave unticked unless you have one)
