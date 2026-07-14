-- Add FILTERED to TrackedItemStatus: items excluded by a scrape filter
-- (e.g. the detail-time "Submitted By" filter) are now retained and marked
-- FILTERED instead of being hard-deleted, so they stay visible in the session.
ALTER TYPE "TrackedItemStatus" ADD VALUE IF NOT EXISTS 'FILTERED';
