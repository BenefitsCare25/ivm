-- CreateTable
CREATE TABLE "provider_groups" (
    "id" TEXT NOT NULL,
    "portalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "providerFieldName" TEXT NOT NULL,
    "matchMode" TEXT NOT NULL DEFAULT 'list',
    "members" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "provider_groups_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "provider_groups_portalId_idx" ON "provider_groups"("portalId");

-- CreateIndex
CREATE UNIQUE INDEX "provider_groups_portalId_name_key" ON "provider_groups"("portalId", "name");

-- AlterTable
ALTER TABLE "comparison_templates" ADD COLUMN "providerGroupId" TEXT;

-- CreateIndex
CREATE INDEX "comparison_templates_providerGroupId_idx" ON "comparison_templates"("providerGroupId");

-- AddForeignKey
ALTER TABLE "provider_groups" ADD CONSTRAINT "provider_groups_portalId_fkey" FOREIGN KEY ("portalId") REFERENCES "portals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comparison_templates" ADD CONSTRAINT "comparison_templates_providerGroupId_fkey" FOREIGN KEY ("providerGroupId") REFERENCES "provider_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;
