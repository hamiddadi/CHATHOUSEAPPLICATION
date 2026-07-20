# Data Retention Policy (RGPD / GDPR)

This is the engineering retention source of truth for ChatHouse. It accompanies
the automated `gdpr-purge` worker and must be reviewed with counsel before a
public release.

## Account lifecycle

- A self-service deletion request sets `User.deletedAt`, immediately revokes
  refresh/access-token families, disconnects Socket.IO sessions, removes push
  tokens, leaves any live room, hides the profile from maps, and clears precise
  coordinates.
- The account remains disabled for
  `ACCOUNT_DELETION_GRACE_DAYS` (default 30). A successful credential-proven
  login during that window restores a self-deleted account. An active
  moderation suspension or permanent admin ban always wins and cannot be
  self-restored.
- After the grace window, the worker deletes private media bytes, tears down
  Stripe resources, hard-deletes the user and lets database foreign-key
  cascades remove associated rows. Object-storage failure fails closed: the
  relational row remains and the worker retries instead of orphaning media.

## Retention matrix

| Data                                                | Retention                                                                          | Automated mechanism                                                                    |
| --------------------------------------------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Self-deleted account and related relational content | 30-day recovery window, then purge                                                 | `gdpr-purge` + database cascades                                                       |
| Private avatars and voice messages                  | Account lifetime                                                                   | Private S3-compatible objects are deleted before user metadata                         |
| Optional map coordinates                            | Until visibility is disabled/deletion is requested, or about 30 days of inactivity | Visibility/deletion paths clear immediately; `location-purge` clears stale coordinates |
| Push notification tokens                            | Active device/account only                                                         | Removed immediately on deletion request and by user cascade                            |
| Refresh tokens                                      | Until expiry/revocation plus one day                                               | Daily `gdpr-purge` sweep                                                               |
| OTP records                                         | Until expiry plus one hour                                                         | Daily `gdpr-purge` sweep; only bcrypt hashes are stored                                |
| Password-reset records                              | Until expiry plus one day                                                          | Daily `gdpr-purge` sweep; raw tokens are never stored                                  |
| Idempotency records                                 | 24 hours                                                                           | Daily expiry sweep and user cascade                                                    |
| Database audit log                                  | `AUDIT_LOG_RETENTION_DAYS` (default 90)                                            | Daily age-based deletion; user references become null when needed for trail integrity  |
| Stripe/customer data                                | Until account purge, subject to narrow legal/payment retention at the processor    | Subscription cancellation and customer deletion before database purge                  |
| Redis extension preferences/history                 | Account lifetime; pending phone capability 30 days; invitation history 1 year      | Included in export; erased/anonymized before relational account purge                  |

Runtime console/infrastructure logs must be configured by the production
platform with access controls and a maximum retention no longer than the stated
security need. They must never include authorization headers, signed media
capabilities, OTPs, passwords, request bodies, or URL query strings.

## Worker behavior

- The repeatable job runs at `GDPR_PURGE_CRON` (default `0 3 * * *`).
- Account, refresh-token, OTP, password-reset, audit and idempotency steps are
  isolated so one category does not prevent the other retention sweeps.
- Each user purge is isolated. External media deletion happens before the
  relational transaction, and failures remain retryable.
- `User.invitedBy` uses `SetNull`, so an invitee is not deleted with the inviter.
- Redis payment mappings and user-owned extension data are removed before the
  relational purge; references retained in another user's history are
  anonymized.

## Data access and portability

Authenticated users receive a structured JSON v4 archive from
`GET /api/users/me/export`. It includes:

- profile, location/visibility and account metadata;
- hosted rooms, recordings metadata, participation, room chat and reactions;
- direct/group messages and group memberships;
- follows, blocks created, houses and memberships;
- notifications, preferences, RSVP and hand-raise history;
- reports filed, profile views, room bans and invite history;
- tips/subscription metadata, audit events and idempotent operation metadata;
- private-media metadata with authenticated signed download links.
- Redis-backed preferences, profile links, search/invitation history, hidden
  rooms, chat reactions and owned room/club extension metadata.

Password hashes, OTPs, access/refresh/reset tokens, raw push tokens, private
storage keys and reports filed by other people are deliberately excluded.

Operators may also run:

```sh
npx tsx scripts/gdpr/export-user-data.ts <userId>
```

Operator-created archives are sensitive temporary files and must be securely
deleted after delivery.

## Validated configuration

`src/config/env.ts` validates these values at process boot:

- `ACCOUNT_DELETION_GRACE_DAYS=30`
- `AUDIT_LOG_RETENTION_DAYS=90`
- `GDPR_PURGE_CRON=0 3 * * *`
