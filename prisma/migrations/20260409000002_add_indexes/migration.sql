-- AddIndex: ExtractionResult.status
CREATE INDEX "extraction_results_status_idx" ON "extraction_results"("status");

-- AddIndex: AuditEvent.eventType
CREATE INDEX "audit_events_event_type_idx" ON "audit_events"("eventType");

-- AddIndex: TrackedItem.status
CREATE INDEX "tracked_items_status_idx" ON "tracked_items"("status");

-- AddIndex: TrackedItem.createdAt
CREATE INDEX "tracked_items_created_at_idx" ON "tracked_items"("createdAt");
