-- CreateTable
CREATE TABLE "portal_daily_metrics" (
    "id" TEXT NOT NULL,
    "portalId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "sessions" INTEGER NOT NULL DEFAULT 0,
    "items" INTEGER NOT NULL DEFAULT 0,
    "compared" INTEGER NOT NULL DEFAULT 0,
    "flagged" INTEGER NOT NULL DEFAULT 0,
    "errors" INTEGER NOT NULL DEFAULT 0,
    "skipped" INTEGER NOT NULL DEFAULT 0,
    "verified" INTEGER NOT NULL DEFAULT 0,
    "requireDoc" INTEGER NOT NULL DEFAULT 0,
    "files" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "portal_daily_metrics_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "portal_daily_metrics_date_idx" ON "portal_daily_metrics"("date");

-- CreateUniqueIndex
CREATE UNIQUE INDEX "portal_daily_metrics_portalId_date_key" ON "portal_daily_metrics"("portalId", "date");

-- AddForeignKey
ALTER TABLE "portal_daily_metrics" ADD CONSTRAINT "portal_daily_metrics_portalId_fkey" FOREIGN KEY ("portalId") REFERENCES "portals"("id") ON DELETE CASCADE ON UPDATE CASCADE;
