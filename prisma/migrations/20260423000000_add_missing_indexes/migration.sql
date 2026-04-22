-- CreateIndex
CREATE INDEX "auth_sessions_userId_idx" ON "auth_sessions"("userId");

-- CreateIndex
CREATE INDEX "tracked_items_scrapeSessionId_status_idx" ON "tracked_items"("scrapeSessionId", "status");

-- CreateIndex
CREATE INDEX "escalation_configs_userId_idx" ON "escalation_configs"("userId");
