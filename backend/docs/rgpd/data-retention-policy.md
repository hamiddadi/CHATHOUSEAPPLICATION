# Data Retention Policy (RGPD / GDPR)

This document describes how long Chathouse keeps each category of personal data,
the lawful basis for processing it, and the mechanism that purges it. It is the
human-readable companion to the automated worker
`backend/src/workers/gdpr-purge.worker.ts` (queue `gdpr-purge`, default cron
`0 3 * * *`, configurable via `GDPR_PURGE_CRON`).

Legal references are to Regulation (EU) 2016/679 (GDPR / RGPD).

## Schema accuracy note

The purge worker matches the **real** Prisma schema, not the original spec:

- Soft-deleted accounts are detected via **`User.deletedAt`** (there is **no**
  `permanentDeletionAt` column). A non-null `deletedAt` plus an elapsed grace
  window is the signal for hard deletion.
- Revoked refresh tokens are detected via **`RefreshToken.revokedAt`** (there is
  **no** `isRevoked` boolean).

## Retention matrix

| Data type                                                                        | Retention                                                                                           | Purge method                                                                                                                                                    | RGPD legal basis                                                                                                                                                                             |
| -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Soft-deleted user accounts                                                       | 30-day grace period after `deletedAt`, then hard delete (`ACCOUNT_DELETION_GRACE_DAYS`, default 30) | `gdpr-purge` worker, step (a): `prisma.user.delete` per id inside a transaction; all child rows cascade at DB level via `onDelete: Cascade`                     | Art. 17 (right to erasure); grace window supported by Art. 6(1)(f) legitimate interest (accidental-deletion recovery, fraud prevention)                                                      |
| Direct messages (1:1 `Message`) and group DMs (`GroupMessage`)                   | Account lifetime — kept while the account exists                                                    | Removed by cascade when the owning `User` is hard-deleted (no standalone purge job)                                                                             | Art. 6(1)(b) performance of the messaging contract; erased under Art. 17 when the account is deleted                                                                                         |
| Revoked / expired refresh tokens (`RefreshToken`)                                | 1 day after expiry, or 1 day after `revokedAt`                                                      | `gdpr-purge` worker, step (b): `deleteMany` where `expiresAt < now-1d` OR (`revokedAt` not null AND `revokedAt < now-1d`)                                       | Art. 5(1)(e) storage limitation; Art. 6(1)(f) legitimate interest (session security / replay-attack forensics during the buffer)                                                             |
| OTP codes (`OtpCode`)                                                            | 1 hour after expiry                                                                                 | `gdpr-purge` worker, step (c): `deleteMany` where `expiresAt < now-1h`                                                                                          | Art. 6(1)(f) legitimate interest (account-security / anti-fraud); Art. 5(1)(e) storage limitation                                                                                            |
| Password-reset tokens (`PasswordResetToken`)                                     | 1 day after expiry (used and unused)                                                                | `gdpr-purge` worker, step (d): `deleteMany` where `expiresAt < now-1d`                                                                                          | Art. 6(1)(f) legitimate interest (account-security); Art. 5(1)(e) storage limitation                                                                                                         |
| Audit logs (`AuditLog`)                                                          | 90 days (`AUDIT_LOG_RETENTION_DAYS`, default 90)                                                    | `gdpr-purge` worker, step (e): `deleteMany` where `createdAt < now-90d`                                                                                         | Art. 6(1)(c) legal obligation / Art. 6(1)(f) legitimate interest (security monitoring, abuse investigation, accountability under Art. 5(2)); Art. 5(1)(e) storage limitation caps the window |
| Avatars / uploads (`User.avatarUrl`, `User.avatarThumb`, files under `/uploads`) | Account lifetime                                                                                    | Deleted together with the account (the `User` row referencing them is hard-deleted by step (a); stored files become orphaned and are reaped by storage cleanup) | Art. 6(1)(b) contract; Art. 17 erasure on account deletion                                                                                                                                   |
| Geolocation (`User.latitude`, `User.longitude`)                                  | Cleared after ~30 days of inactivity                                                                | Existing `location-purge` worker (`src/queues/locationPurge.ts`): nulls `latitude`/`longitude` for users whose `lastSeenAt` is older than 30 days               | Art. 6(1)(a) consent (Ghost Mode is on by default; the user must opt in to map visibility); Art. 5(1)(c) data minimisation; Art. 5(1)(e) storage limitation                                  |

## Purge worker behaviour

- **Schedule.** One repeatable job per day at `GDPR_PURGE_CRON` (default
  `0 3 * * *`). On boot the worker clears any existing repeatable of the same
  name before re-adding it, so a changed cron pattern across redeploys cannot
  leave an orphaned repeatable that double-fires.
- **Isolation.** Each retention step (a)–(e) is wrapped in its own try/catch and
  logs its deleted count; a single failing step never aborts the others.
- **User hard-delete.** Target users are resolved first, then each is deleted
  inside `prisma.$transaction` so the per-user cascade is atomic. The
  self-relation `User.invitedBy` is `SetNull`, so people invited by a deleted
  user survive with `invitedById = null`.

## Data export (RGPD Art. 20 — portability)

Operators can produce a portable archive of a single user's data with:

```
npx tsx scripts/gdpr/export-user-data.ts <userId>
```

The script writes a real `.zip` to `./exports/export-<userId>-<timestamp>.zip`
containing `profil.json` (the `User` row with `passwordHash` stripped),
`messages.json` (1:1 and group messages), `follows.json`, and `audit.json`.
It is the basis for the authenticated `GET /api/users/me/export` portability
endpoint.

## Recommended environment variables

These are read defensively with defaults; add them to `src/config/env.ts` for
validated configuration:

- `GDPR_PURGE_CRON` (default `0 3 * * *`)
- `ACCOUNT_DELETION_GRACE_DAYS` (default `30`)
- `AUDIT_LOG_RETENTION_DAYS` (default `90`)
