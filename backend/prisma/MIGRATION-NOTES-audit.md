# Audit hardening — Prisma migration notes

The audit fixes changed `schema.prisma` but the Prisma client could **not** be
regenerated in the fix environment (the Windows query-engine DLL was locked —
`EPERM`). Before deploying, run:

```bash
cd backend
npx prisma generate          # refresh the client to match the schema
npx prisma migrate dev --name audit_hardening   # or: migrate diff + deploy in CI
```

## Schema changes applied (additive / safe)

- **`Message.receiver` FK** — `receiverId` was a dangling string with no
  referential integrity. Added `receiver User? @relation("MessageReceiver", … onDelete: Cascade)`
  - the `User.receivedMessages` back-relation.
    ⚠️ Migration may fail if existing `Message.receiverId` rows reference
    deleted/non-existent users. Clean up first:
  ```sql
  UPDATE "Message" SET "receiverId" = NULL
  WHERE "receiverId" IS NOT NULL
    AND "receiverId" NOT IN (SELECT id FROM "User");
  ```
- **Text bounds** — `Message.content` → `VARCHAR(4000)`, `Notification.title` →
  `VARCHAR(150)`, `Notification.body` → `VARCHAR(500)` (were unbounded `TEXT`).
  ⚠️ Migration fails if existing rows exceed the new length; truncate or widen
  the cap if your data needs it.
- **Indexes** — `User @@index([isVisible, isOnline, lastSeenAt])` (map query),
  `OtpCode @@index([phoneNumber, isUsed, expiresAt])` (verify lookup).

## Follow-ups requiring a manual migration (NOT applied — need DBA review)

- **Case-insensitive email** (`User.email`): the auth layer now lower-cases
  email app-side, which fixes the duplicate-account/reset bypass. For defence
  in depth, migrate the column to `citext`:
  ```sql
  CREATE EXTENSION IF NOT EXISTS citext;
  ALTER TABLE "User" ALTER COLUMN email TYPE citext;
  ```
- **Soft-delete vs global `@unique`**: a soft-deleted account still holds its
  `username`/`email`/`phoneNumber` unique slot, blocking re-registration.
  Consider partial unique indexes scoped to `deletedAt IS NULL`.
- **`Report` polymorphic CHECK**: enforce "exactly one of reportedId /
  reportedRoomId" with a DB CHECK constraint (Prisma can't express it):
  ```sql
  ALTER TABLE "Report" ADD CONSTRAINT report_one_target
    CHECK ((("reportedId" IS NOT NULL)::int + ("reportedRoomId" IS NOT NULL)::int) = 1);
  ```
