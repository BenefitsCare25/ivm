-- Intelligence Hub: Phase 1-5 models

CREATE TYPE "ValidationStatus" AS ENUM ('PASS', 'FAIL', 'WARNING');

-- Phase 1: Document Types & Validation

CREATE TABLE "document_types" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "aliases" JSONB NOT NULL DEFAULT '[]',
    "category" TEXT,
    "requiredFields" JSONB NOT NULL DEFAULT '[]',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "document_types_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "document_types_userId_name_key" ON "document_types"("userId", "name");
CREATE INDEX "document_types_userId_idx" ON "document_types"("userId");
ALTER TABLE "document_types" ADD CONSTRAINT "document_types_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "document_sets" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "document_sets_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "document_sets_userId_name_key" ON "document_sets"("userId", "name");
CREATE INDEX "document_sets_userId_idx" ON "document_sets"("userId");
ALTER TABLE "document_sets" ADD CONSTRAINT "document_sets_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "document_set_items" (
    "id" TEXT NOT NULL,
    "documentSetId" TEXT NOT NULL,
    "documentTypeId" TEXT NOT NULL,
    "isRequired" BOOLEAN NOT NULL DEFAULT true,
    "minCount" INTEGER NOT NULL DEFAULT 1,
    "maxCount" INTEGER,
    CONSTRAINT "document_set_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "document_set_items_documentSetId_documentTypeId_key" ON "document_set_items"("documentSetId", "documentTypeId");
ALTER TABLE "document_set_items" ADD CONSTRAINT "document_set_items_documentSetId_fkey" FOREIGN KEY ("documentSetId") REFERENCES "document_sets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "document_set_items" ADD CONSTRAINT "document_set_items_documentTypeId_fkey" FOREIGN KEY ("documentTypeId") REFERENCES "document_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "validation_results" (
    "id" TEXT NOT NULL,
    "fillSessionId" TEXT,
    "trackedItemId" TEXT,
    "ruleType" TEXT NOT NULL,
    "status" "ValidationStatus" NOT NULL,
    "message" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "validation_results_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "validation_results_fillSessionId_idx" ON "validation_results"("fillSessionId");
CREATE INDEX "validation_results_trackedItemId_idx" ON "validation_results"("trackedItemId");

-- Phase 2: Reference Datasets & Code Mapping

CREATE TABLE "reference_datasets" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "columns" JSONB NOT NULL DEFAULT '[]',
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "sourceType" TEXT NOT NULL DEFAULT 'manual',
    "version" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "reference_datasets_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "reference_datasets_userId_name_key" ON "reference_datasets"("userId", "name");
CREATE INDEX "reference_datasets_userId_idx" ON "reference_datasets"("userId");
ALTER TABLE "reference_datasets" ADD CONSTRAINT "reference_datasets_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "reference_entries" (
    "id" TEXT NOT NULL,
    "datasetId" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "searchText" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "reference_entries_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "reference_entries_datasetId_idx" ON "reference_entries"("datasetId");
ALTER TABLE "reference_entries" ADD CONSTRAINT "reference_entries_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "reference_datasets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "code_mapping_rules" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sourceFieldLabel" TEXT NOT NULL,
    "datasetId" TEXT NOT NULL,
    "lookupColumn" TEXT NOT NULL,
    "outputColumn" TEXT NOT NULL,
    "matchStrategy" TEXT NOT NULL DEFAULT 'fuzzy',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "code_mapping_rules_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "code_mapping_rules_userId_idx" ON "code_mapping_rules"("userId");
ALTER TABLE "code_mapping_rules" ADD CONSTRAINT "code_mapping_rules_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "code_mapping_rules" ADD CONSTRAINT "code_mapping_rules_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "reference_datasets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Phase 3: Business Rules Engine

CREATE TABLE "business_rules" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "triggerPoint" TEXT NOT NULL,
    "conditions" JSONB NOT NULL,
    "actions" JSONB NOT NULL,
    "scope" JSONB NOT NULL DEFAULT '{}',
    "runCount" INTEGER NOT NULL DEFAULT 0,
    "lastRunAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "business_rules_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "business_rules_userId_idx" ON "business_rules"("userId");
CREATE INDEX "business_rules_triggerPoint_idx" ON "business_rules"("triggerPoint");
ALTER TABLE "business_rules" ADD CONSTRAINT "business_rules_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "rule_executions" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "fillSessionId" TEXT,
    "trackedItemId" TEXT,
    "triggered" BOOLEAN NOT NULL,
    "actionsRun" JSONB NOT NULL DEFAULT '[]',
    "inputSnapshot" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "rule_executions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "rule_executions_ruleId_idx" ON "rule_executions"("ruleId");
CREATE INDEX "rule_executions_fillSessionId_idx" ON "rule_executions"("fillSessionId");
CREATE INDEX "rule_executions_trackedItemId_idx" ON "rule_executions"("trackedItemId");
CREATE INDEX "rule_executions_createdAt_idx" ON "rule_executions"("createdAt");
ALTER TABLE "rule_executions" ADD CONSTRAINT "rule_executions_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "business_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Phase 4: Smart Extraction

CREATE TABLE "extraction_templates" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "documentTypeId" TEXT,
    "name" TEXT NOT NULL,
    "expectedFields" JSONB NOT NULL DEFAULT '[]',
    "instructions" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "extraction_templates_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "extraction_templates_userId_idx" ON "extraction_templates"("userId");
CREATE INDEX "extraction_templates_documentTypeId_idx" ON "extraction_templates"("documentTypeId");
ALTER TABLE "extraction_templates" ADD CONSTRAINT "extraction_templates_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "extraction_templates" ADD CONSTRAINT "extraction_templates_documentTypeId_fkey" FOREIGN KEY ("documentTypeId") REFERENCES "document_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "normalization_rules" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "fieldType" TEXT NOT NULL,
    "pattern" TEXT,
    "outputFormat" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "normalization_rules_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "normalization_rules_userId_idx" ON "normalization_rules"("userId");
ALTER TABLE "normalization_rules" ADD CONSTRAINT "normalization_rules_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "escalation_configs" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "confidenceThreshold" DOUBLE PRECISION NOT NULL DEFAULT 0.7,
    "autoFlagLowConfidence" BOOLEAN NOT NULL DEFAULT true,
    "escalationMessage" TEXT NOT NULL DEFAULT 'Low confidence extraction — requires human review',
    CONSTRAINT "escalation_configs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "escalation_configs_userId_key" ON "escalation_configs"("userId");
ALTER TABLE "escalation_configs" ADD CONSTRAINT "escalation_configs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Phase 5: Analytics

CREATE TABLE "processing_metrics" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "metricType" TEXT NOT NULL,
    "metricKey" TEXT NOT NULL,
    "metricValue" DOUBLE PRECISION NOT NULL,
    "period" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "processing_metrics_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "processing_metrics_userId_metricType_period_idx" ON "processing_metrics"("userId", "metricType", "period");
CREATE INDEX "processing_metrics_metricKey_idx" ON "processing_metrics"("metricKey");
