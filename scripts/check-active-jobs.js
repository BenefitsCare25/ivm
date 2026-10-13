let PrismaClient;
try {
  ({ PrismaClient } = require("./node_modules/.prisma/client"));
} catch (error) {
  if (error?.code !== "MODULE_NOT_FOUND") throw error;
  ({ PrismaClient } = require("./.next/standalone/node_modules/.prisma/client"));
}
const db = new PrismaClient();
let queue;
let redis;

(async () => {
  try {
    const sessions = await db.scrapeSession.count({
      where: { status: { in: ["RUNNING", "PENDING"] } },
    });
    // This gate runs before migrations; text casts also work on the old enum.
    const [{ count }] = await db.$queryRaw`
      SELECT COUNT(*)::int AS count FROM tracked_items i
      JOIN scrape_sessions s ON s.id = i."scrapeSessionId"
      WHERE i.status::text = 'PROCESSING'
        OR (i.status::text = 'RETRYING' AND s.status::text <> 'CANCELLED')
    `;
    let activeJobs = 0;
    if (process.env.REDIS_URL) {
      const { Queue } = require("bullmq");
      const Redis = require("ioredis");
      redis = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: 1, connectTimeout: 10000 });
      queue = new Queue("item-detail", { connection: redis });
      activeJobs = await queue.getActiveCount();
    }
    console.log(`${sessions}|${Math.max(count, activeJobs)}`);
  } finally {
    await db.$disconnect();
    if (queue) await queue.close();
    if (redis) await redis.quit();
  }
})();
