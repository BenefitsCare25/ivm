-- Add fileHash column for FWA tampering detection
ALTER TABLE "tracked_item_files" ADD COLUMN "fileHash" TEXT;
