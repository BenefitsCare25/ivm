-- AlterTable
ALTER TABLE "portals" ADD COLUMN "defaultDocumentTypeId" TEXT;

-- AddForeignKey
ALTER TABLE "portals" ADD CONSTRAINT "portals_defaultDocumentTypeId_fkey" FOREIGN KEY ("defaultDocumentTypeId") REFERENCES "document_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;
