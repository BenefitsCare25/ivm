-- CreateEnum
CREATE TYPE "FillSessionStatus" AS ENUM ('CREATED', 'SOURCE_UPLOADED', 'EXTRACTED', 'TARGET_SET', 'MAPPED', 'FILLED', 'REVIEWED', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "SessionStep" AS ENUM ('SOURCE', 'EXTRACT', 'TARGET', 'MAP', 'FILL', 'REVIEW');

-- CreateEnum
CREATE TYPE "ExtractionStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "TargetType" AS ENUM ('WEBPAGE', 'PDF', 'DOCX');

-- CreateEnum
CREATE TYPE "MappingStatus" AS ENUM ('PROPOSED', 'REVIEWED', 'ACCEPTED');

-- CreateEnum
CREATE TYPE "FillActionStatus" AS ENUM ('PENDING', 'APPLIED', 'VERIFIED', 'FAILED', 'SKIPPED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "passwordHash" TEXT,
    "image" TEXT,
    "emailVerified" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_sessions" (
    "id" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "auth_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_tokens" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "fill_sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "FillSessionStatus" NOT NULL DEFAULT 'CREATED',
    "currentStep" "SessionStep" NOT NULL DEFAULT 'SOURCE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fill_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "source_assets" (
    "id" TEXT NOT NULL,
    "fillSessionId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "storagePath" TEXT NOT NULL,
    "storageProvider" TEXT NOT NULL DEFAULT 'local',
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "source_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "extraction_results" (
    "id" TEXT NOT NULL,
    "fillSessionId" TEXT NOT NULL,
    "sourceAssetId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'anthropic',
    "rawResponse" JSONB,
    "documentType" TEXT,
    "fields" JSONB NOT NULL DEFAULT '[]',
    "status" "ExtractionStatus" NOT NULL DEFAULT 'PENDING',
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "errorMessage" TEXT,

    CONSTRAINT "extraction_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "target_assets" (
    "id" TEXT NOT NULL,
    "fillSessionId" TEXT NOT NULL,
    "targetType" "TargetType" NOT NULL,
    "url" TEXT,
    "fileName" TEXT,
    "storagePath" TEXT,
    "detectedFields" JSONB NOT NULL DEFAULT '[]',
    "isSupported" BOOLEAN NOT NULL DEFAULT true,
    "unsupportedReason" TEXT,
    "inspectedAt" TIMESTAMP(3),

    CONSTRAINT "target_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mapping_sets" (
    "id" TEXT NOT NULL,
    "fillSessionId" TEXT NOT NULL,
    "extractionResultId" TEXT NOT NULL,
    "targetAssetId" TEXT NOT NULL,
    "mappings" JSONB NOT NULL DEFAULT '[]',
    "status" "MappingStatus" NOT NULL DEFAULT 'PROPOSED',
    "proposedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),

    CONSTRAINT "mapping_sets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fill_actions" (
    "id" TEXT NOT NULL,
    "fillSessionId" TEXT NOT NULL,
    "mappingSetId" TEXT NOT NULL,
    "targetFieldId" TEXT NOT NULL,
    "intendedValue" TEXT NOT NULL,
    "appliedValue" TEXT,
    "verifiedValue" TEXT,
    "status" "FillActionStatus" NOT NULL DEFAULT 'PENDING',
    "appliedAt" TIMESTAMP(3),
    "verifiedAt" TIMESTAMP(3),
    "errorMessage" TEXT,

    CONSTRAINT "fill_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" TEXT NOT NULL,
    "fillSessionId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "actor" TEXT NOT NULL DEFAULT 'SYSTEM',
    "payload" JSONB NOT NULL DEFAULT '{}',
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Account_provider_providerAccountId_key" ON "Account"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "auth_sessions_sessionToken_key" ON "auth_sessions"("sessionToken");

-- CreateIndex
CREATE UNIQUE INDEX "verification_tokens_token_key" ON "verification_tokens"("token");

-- CreateIndex
CREATE UNIQUE INDEX "verification_tokens_identifier_token_key" ON "verification_tokens"("identifier", "token");

-- CreateIndex
CREATE INDEX "fill_sessions_userId_idx" ON "fill_sessions"("userId");

-- CreateIndex
CREATE INDEX "source_assets_fillSessionId_idx" ON "source_assets"("fillSessionId");

-- CreateIndex
CREATE INDEX "extraction_results_fillSessionId_idx" ON "extraction_results"("fillSessionId");

-- CreateIndex
CREATE INDEX "target_assets_fillSessionId_idx" ON "target_assets"("fillSessionId");

-- CreateIndex
CREATE INDEX "mapping_sets_fillSessionId_idx" ON "mapping_sets"("fillSessionId");

-- CreateIndex
CREATE INDEX "fill_actions_fillSessionId_idx" ON "fill_actions"("fillSessionId");

-- CreateIndex
CREATE INDEX "fill_actions_mappingSetId_idx" ON "fill_actions"("mappingSetId");

-- CreateIndex
CREATE INDEX "audit_events_fillSessionId_idx" ON "audit_events"("fillSessionId");

-- CreateIndex
CREATE INDEX "audit_events_timestamp_idx" ON "audit_events"("timestamp");

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fill_sessions" ADD CONSTRAINT "fill_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_assets" ADD CONSTRAINT "source_assets_fillSessionId_fkey" FOREIGN KEY ("fillSessionId") REFERENCES "fill_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extraction_results" ADD CONSTRAINT "extraction_results_fillSessionId_fkey" FOREIGN KEY ("fillSessionId") REFERENCES "fill_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extraction_results" ADD CONSTRAINT "extraction_results_sourceAssetId_fkey" FOREIGN KEY ("sourceAssetId") REFERENCES "source_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "target_assets" ADD CONSTRAINT "target_assets_fillSessionId_fkey" FOREIGN KEY ("fillSessionId") REFERENCES "fill_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mapping_sets" ADD CONSTRAINT "mapping_sets_fillSessionId_fkey" FOREIGN KEY ("fillSessionId") REFERENCES "fill_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mapping_sets" ADD CONSTRAINT "mapping_sets_extractionResultId_fkey" FOREIGN KEY ("extractionResultId") REFERENCES "extraction_results"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mapping_sets" ADD CONSTRAINT "mapping_sets_targetAssetId_fkey" FOREIGN KEY ("targetAssetId") REFERENCES "target_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fill_actions" ADD CONSTRAINT "fill_actions_fillSessionId_fkey" FOREIGN KEY ("fillSessionId") REFERENCES "fill_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fill_actions" ADD CONSTRAINT "fill_actions_mappingSetId_fkey" FOREIGN KEY ("mappingSetId") REFERENCES "mapping_sets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_fillSessionId_fkey" FOREIGN KEY ("fillSessionId") REFERENCES "fill_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
