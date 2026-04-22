-- CreateTable
CREATE TABLE "comparison_configs" (
    "id" TEXT NOT NULL,
    "portalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "groupingFields" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "comparison_configs_pkey" PRIMARY KEY ("id")
);

-- AddColumn
ALTER TABLE "comparison_templates" ADD COLUMN "comparisonConfigId" TEXT;

-- CreateIndex
CREATE INDEX "comparison_configs_portalId_idx" ON "comparison_configs"("portalId");

-- CreateUniqueIndex
CREATE UNIQUE INDEX "comparison_configs_portalId_name_key" ON "comparison_configs"("portalId", "name");

-- CreateIndex
CREATE INDEX "comparison_templates_comparisonConfigId_idx" ON "comparison_templates"("comparisonConfigId");

-- AddForeignKey
ALTER TABLE "comparison_configs" ADD CONSTRAINT "comparison_configs_portalId_fkey" FOREIGN KEY ("portalId") REFERENCES "portals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comparison_templates" ADD CONSTRAINT "comparison_templates_comparisonConfigId_fkey" FOREIGN KEY ("comparisonConfigId") REFERENCES "comparison_configs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- DataMigration: Create a ComparisonConfig for each portal that has groupingFields or templates
INSERT INTO "comparison_configs" ("id", "portalId", "name", "groupingFields", "createdAt", "updatedAt")
SELECT
    gen_random_uuid()::text,
    p."id",
    'Claims Configuration',
    p."groupingFields",
    NOW(),
    NOW()
FROM "portals" p
WHERE (p."groupingFields" IS NOT NULL AND p."groupingFields" != '[]'::jsonb)
   OR EXISTS (SELECT 1 FROM "comparison_templates" ct WHERE ct."portalId" = p."id");

-- DataMigration: Link existing templates to their portal's config
UPDATE "comparison_templates" ct
SET "comparisonConfigId" = cc."id"
FROM "comparison_configs" cc
WHERE cc."portalId" = ct."portalId";
