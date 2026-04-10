-- AlterTable
ALTER TABLE "scrape_sessions" ADD COLUMN "expectedDocumentTypeId" TEXT;
ALTER TABLE "scrape_sessions" ADD COLUMN "expectedDocumentSetId" TEXT;

-- AddForeignKey
ALTER TABLE "scrape_sessions" ADD CONSTRAINT "scrape_sessions_expectedDocumentTypeId_fkey" FOREIGN KEY ("expectedDocumentTypeId") REFERENCES "document_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scrape_sessions" ADD CONSTRAINT "scrape_sessions_expectedDocumentSetId_fkey" FOREIGN KEY ("expectedDocumentSetId") REFERENCES "document_sets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
