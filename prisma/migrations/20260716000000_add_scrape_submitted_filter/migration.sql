-- Per-run "Submitted On" date filter for portal scrape sessions
ALTER TABLE "scrape_sessions" ADD COLUMN "submittedFrom" TIMESTAMP(3);
ALTER TABLE "scrape_sessions" ADD COLUMN "submittedTo" TIMESTAMP(3);
