-- Recover the meaning of legacy pending claims without touching saved reviews
-- or activating cancelled sessions. Existing BullMQ jobs retain their actual
-- retry budget; their next attempt writes that budget to the new counter.
UPDATE "tracked_items" AS item
SET "status" = 'RETRYING'::"TrackedItemStatus"
FROM "scrape_sessions" AS session
WHERE item."scrapeSessionId" = session."id"
  AND item."status" = 'DISCOVERED'
  AND item."errorMessage" LIKE 'Waiting for AI recovery.%';
