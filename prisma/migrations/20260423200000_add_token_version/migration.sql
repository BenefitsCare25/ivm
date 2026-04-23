-- Add tokenVersion to User for JWT invalidation on password change
ALTER TABLE "User" ADD COLUMN "tokenVersion" INTEGER NOT NULL DEFAULT 0;
