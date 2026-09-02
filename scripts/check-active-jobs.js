let PrismaClient;
try {
  ({ PrismaClient } = require("./node_modules/.prisma/client"));
} catch (error) {
  if (error?.code !== "MODULE_NOT_FOUND") throw error;
  ({ PrismaClient } = require("./.next/standalone/node_modules/.prisma/client"));
}
const db = new PrismaClient();

(async () => {
  try {
    const sessions = await db.scrapeSession.count({
      where: { status: { in: ["RUNNING", "PENDING"] } },
    });
    const items = await db.trackedItem.count({
      where: { status: "PROCESSING" },
    });
    console.log(`${sessions}|${items}`);
  } finally {
    await db.$disconnect();
  }
})();
