-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('SUPER_ADMIN', 'ADMIN');

-- AlterTable: add role column with default ADMIN
ALTER TABLE "User" ADD COLUMN "role" "UserRole" NOT NULL DEFAULT 'ADMIN';

-- Set Super Admin
UPDATE "User" SET "role" = 'SUPER_ADMIN' WHERE "email" = 'hui.en194@gmail.com';
