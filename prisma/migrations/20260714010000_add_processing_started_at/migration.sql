-- Track when an item's processing (re)started, so runtime reflects actual
-- processing duration instead of the createdAt→updatedAt span (which balloons
-- when an item waits in the queue or is reprocessed).
ALTER TABLE "tracked_items" ADD COLUMN "processingStartedAt" TIMESTAMP(3);
