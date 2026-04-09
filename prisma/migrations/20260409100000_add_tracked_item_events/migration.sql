-- CreateTable
CREATE TABLE "tracked_item_events" (
    "id" TEXT NOT NULL,
    "trackedItemId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "screenshotPath" TEXT,
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tracked_item_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tracked_item_events_trackedItemId_createdAt_idx" ON "tracked_item_events"("trackedItemId", "createdAt");

-- AddForeignKey
ALTER TABLE "tracked_item_events" ADD CONSTRAINT "tracked_item_events_trackedItemId_fkey" FOREIGN KEY ("trackedItemId") REFERENCES "tracked_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
