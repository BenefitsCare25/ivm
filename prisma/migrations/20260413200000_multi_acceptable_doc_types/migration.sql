-- Migration: replace single FK doc type fields with string arrays

-- Portal: replace defaultDocumentTypeId FK with defaultDocumentTypeIds array
ALTER TABLE "portals" ADD COLUMN "defaultDocumentTypeIds" TEXT[] NOT NULL DEFAULT '{}';
UPDATE "portals" SET "defaultDocumentTypeIds" = ARRAY["defaultDocumentTypeId"] WHERE "defaultDocumentTypeId" IS NOT NULL;
ALTER TABLE "portals" DROP COLUMN "defaultDocumentTypeId";

-- ScrapeSession: replace expectedDocumentTypeId FK with acceptableDocumentTypeIds array
ALTER TABLE "scrape_sessions" ADD COLUMN "acceptableDocumentTypeIds" TEXT[] NOT NULL DEFAULT '{}';
UPDATE "scrape_sessions" SET "acceptableDocumentTypeIds" = ARRAY["expectedDocumentTypeId"] WHERE "expectedDocumentTypeId" IS NOT NULL;
ALTER TABLE "scrape_sessions" DROP COLUMN "expectedDocumentTypeId";
