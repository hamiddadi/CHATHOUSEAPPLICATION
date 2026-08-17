-- Private object-storage metadata for avatars and voice notes.
CREATE TYPE "MediaKind" AS ENUM ('AVATAR', 'VOICE');

CREATE TABLE "MediaObject" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "storageKey" VARCHAR(512) NOT NULL,
    "kind" "MediaKind" NOT NULL,
    "mimeType" VARCHAR(100) NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MediaObject_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MediaObject_storageKey_key" ON "MediaObject"("storageKey");
CREATE INDEX "MediaObject_ownerId_kind_createdAt_idx"
ON "MediaObject"("ownerId", "kind", "createdAt");

ALTER TABLE "MediaObject"
ADD CONSTRAINT "MediaObject_ownerId_fkey"
FOREIGN KEY ("ownerId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
