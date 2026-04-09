-- AlterTable: add groupingFields to portals
ALTER TABLE "portals" ADD COLUMN "groupingFields" JSONB NOT NULL DEFAULT '[]';

-- AlterTable: add templateId to comparison_results
ALTER TABLE "comparison_results" ADD COLUMN "templateId" TEXT;

-- CreateTable: comparison_templates
CREATE TABLE "comparison_templates" (
    "id" TEXT NOT NULL,
    "portalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "groupingKey" JSONB NOT NULL DEFAULT '{}',
    "fields" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "comparison_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "comparison_templates_portalId_idx" ON "comparison_templates"("portalId");

-- CreateIndex
CREATE UNIQUE INDEX "comparison_templates_portalId_name_key" ON "comparison_templates"("portalId", "name");

-- AddForeignKey
ALTER TABLE "comparison_templates" ADD CONSTRAINT "comparison_templates_portalId_fkey" FOREIGN KEY ("portalId") REFERENCES "portals"("id") ON DELETE CASCADE ON UPDATE CASCADE;
