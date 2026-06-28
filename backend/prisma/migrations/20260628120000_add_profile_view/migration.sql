-- CreateTable
-- ProfileView model exists in schema.prisma but was missing from the squashed
-- baseline migration (00000000000000_init), so `prisma migrate deploy` never
-- created the table in production. This adds it. SQL mirrors the definition that
-- was generated on fix/prod-readiness-audit (audit 2026-06-28).
CREATE TABLE "ProfileView" (
    "id" TEXT NOT NULL,
    "viewerId" TEXT NOT NULL,
    "viewedUserId" TEXT NOT NULL,
    "viewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProfileView_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProfileView_viewedUserId_viewedAt_idx" ON "ProfileView"("viewedUserId", "viewedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProfileView_viewerId_viewedUserId_key" ON "ProfileView"("viewerId", "viewedUserId");

-- AddForeignKey
ALTER TABLE "ProfileView" ADD CONSTRAINT "ProfileView_viewerId_fkey" FOREIGN KEY ("viewerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfileView" ADD CONSTRAINT "ProfileView_viewedUserId_fkey" FOREIGN KEY ("viewedUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
