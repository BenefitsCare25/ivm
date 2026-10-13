-- Expand only. Older application versions ignore the nullable retry timestamp
-- and the attempt counter. Add the enum in this migration; use it only after
-- this migration commits.
ALTER TYPE "TrackedItemStatus" ADD VALUE IF NOT EXISTS 'RETRYING' AFTER 'DISCOVERED';
ALTER TABLE "tracked_items"
  ADD COLUMN "aiRecoveryAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "retryAt" TIMESTAMP(3);

-- Rollback requires a forward data migration mapping RETRYING to DISCOVERED
-- before running an older application. Keep the extra columns and enum value.
