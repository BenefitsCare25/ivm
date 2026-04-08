import "@/lib/env";
import { PrismaClient } from "@prisma/client";
import { logger } from "@/lib/logger";
import { disconnectRedis } from "@/lib/redis";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === "development"
        ? ["query", "error", "warn"]
        : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;

if (process.env.NODE_ENV === "production") {
  const shutdown = async (signal: string) => {
    logger.info({ signal }, "Shutting down gracefully...");
    await db.$disconnect();
    await disconnectRedis();
    process.exit(0);
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}
