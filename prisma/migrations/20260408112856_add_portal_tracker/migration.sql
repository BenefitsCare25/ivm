-- CreateEnum
CREATE TYPE "PortalAuthMethod" AS ENUM ('COOKIES', 'CREDENTIALS');

-- CreateEnum
CREATE TYPE "ScrapeSessionStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TrackedItemStatus" AS ENUM ('DISCOVERED', 'PROCESSING', 'COMPARED', 'FLAGGED', 'VERIFIED', 'ERROR');

-- CreateEnum
CREATE TYPE "ComparisonFieldStatus" AS ENUM ('MATCH', 'MISMATCH', 'MISSING_IN_PDF', 'MISSING_ON_PAGE', 'UNCERTAIN');

-- CreateTable
CREATE TABLE "portals" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "authMethod" "PortalAuthMethod" NOT NULL DEFAULT 'COOKIES',
    "listPageUrl" TEXT,
    "listSelectors" JSONB NOT NULL DEFAULT '{}',
    "detailSelectors" JSONB NOT NULL DEFAULT '{}',
    "scheduleEnabled" BOOLEAN NOT NULL DEFAULT false,
    "scheduleCron" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "portals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portal_credentials" (
    "id" TEXT NOT NULL,
    "portalId" TEXT NOT NULL,
    "encryptedUsername" TEXT,
    "encryptedPassword" TEXT,
    "cookieData" JSONB,
    "cookieExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "portal_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scrape_sessions" (
    "id" TEXT NOT NULL,
    "portalId" TEXT NOT NULL,
    "status" "ScrapeSessionStatus" NOT NULL DEFAULT 'PENDING',
    "triggeredBy" TEXT NOT NULL DEFAULT 'MANUAL',
    "itemsFound" INTEGER NOT NULL DEFAULT 0,
    "itemsProcessed" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scrape_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tracked_items" (
    "id" TEXT NOT NULL,
    "scrapeSessionId" TEXT NOT NULL,
    "portalItemId" TEXT NOT NULL,
    "listData" JSONB NOT NULL DEFAULT '{}',
    "detailData" JSONB,
    "detailPageUrl" TEXT,
    "status" "TrackedItemStatus" NOT NULL DEFAULT 'DISCOVERED',
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tracked_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tracked_item_files" (
    "id" TEXT NOT NULL,
    "trackedItemId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "storagePath" TEXT NOT NULL,
    "storageProvider" TEXT NOT NULL DEFAULT 'local',
    "downloadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tracked_item_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comparison_results" (
    "id" TEXT NOT NULL,
    "trackedItemId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'anthropic',
    "fieldComparisons" JSONB NOT NULL DEFAULT '[]',
    "matchCount" INTEGER NOT NULL DEFAULT 0,
    "mismatchCount" INTEGER NOT NULL DEFAULT 0,
    "summary" TEXT,
    "completedAt" TIMESTAMP(3),
    "errorMessage" TEXT,

    CONSTRAINT "comparison_results_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "portals_userId_idx" ON "portals"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "portal_credentials_portalId_key" ON "portal_credentials"("portalId");

-- CreateIndex
CREATE INDEX "scrape_sessions_portalId_idx" ON "scrape_sessions"("portalId");

-- CreateIndex
CREATE INDEX "scrape_sessions_createdAt_idx" ON "scrape_sessions"("createdAt");

-- CreateIndex
CREATE INDEX "tracked_items_scrapeSessionId_idx" ON "tracked_items"("scrapeSessionId");

-- CreateIndex
CREATE INDEX "tracked_items_portalItemId_idx" ON "tracked_items"("portalItemId");

-- CreateIndex
CREATE INDEX "tracked_item_files_trackedItemId_idx" ON "tracked_item_files"("trackedItemId");

-- CreateIndex
CREATE UNIQUE INDEX "comparison_results_trackedItemId_key" ON "comparison_results"("trackedItemId");

-- AddForeignKey
ALTER TABLE "portals" ADD CONSTRAINT "portals_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_credentials" ADD CONSTRAINT "portal_credentials_portalId_fkey" FOREIGN KEY ("portalId") REFERENCES "portals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scrape_sessions" ADD CONSTRAINT "scrape_sessions_portalId_fkey" FOREIGN KEY ("portalId") REFERENCES "portals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tracked_items" ADD CONSTRAINT "tracked_items_scrapeSessionId_fkey" FOREIGN KEY ("scrapeSessionId") REFERENCES "scrape_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tracked_item_files" ADD CONSTRAINT "tracked_item_files_trackedItemId_fkey" FOREIGN KEY ("trackedItemId") REFERENCES "tracked_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comparison_results" ADD CONSTRAINT "comparison_results_trackedItemId_fkey" FOREIGN KEY ("trackedItemId") REFERENCES "tracked_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
