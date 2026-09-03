ALTER TABLE "scrape_sessions"
ADD COLUMN "claimConcurrency" INTEGER NOT NULL DEFAULT 3;
