-- DropIndex
DROP INDEX IF EXISTS "comparison_templates_portalId_name_key";

-- CreateIndex
CREATE UNIQUE INDEX "comparison_templates_portalId_name_providerGroupId_key" ON "comparison_templates"("portalId", "name", "providerGroupId");

-- Partial unique index for NULL providerGroupId (PostgreSQL treats NULLs as distinct in unique indexes)
CREATE UNIQUE INDEX "comparison_templates_portalId_name_no_group_key" ON "comparison_templates"("portalId", "name") WHERE "providerGroupId" IS NULL;
