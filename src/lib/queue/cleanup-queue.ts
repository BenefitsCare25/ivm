import { Queue, Worker } from "bullmq";
import { getQueueConnection } from "./connection";
import { logger } from "@/lib/logger";

const QUEUE_NAME = "storage-cleanup";
const REPEAT_EVERY_MS = 24 * 60 * 60 * 1000; // 24 hours

let cleanupQueue: Queue | null = null;

export function getCleanupQueue(): Queue | null {
  const conn = getQueueConnection();
  if (!conn) return null;

  if (!cleanupQueue) {
    cleanupQueue = new Queue(QUEUE_NAME, {
      connection: conn,
      defaultJobOptions: {
        removeOnComplete: { count: 5 },
        removeOnFail: { count: 5 },
      },
    });
  }

  return cleanupQueue;
}

export async function scheduleStorageCleanup(): Promise<void> {
  const queue = getCleanupQueue();
  if (!queue) {
    logger.warn("[cleanup] Redis unavailable — storage cleanup not scheduled");
    return;
  }

  // Remove stale repeatable jobs from previous deployments before re-adding
  const existing = await queue.getRepeatableJobs();
  for (const job of existing) {
    await queue.removeRepeatableByKey(job.key);
  }

  await queue.add(
    "cleanup",
    {},
    {
      repeat: { every: REPEAT_EVERY_MS },
      jobId: "storage-cleanup-repeat",
    }
  );

  logger.info({ everyHours: 24 }, "[cleanup] Storage cleanup scheduled");
}

export function startCleanupWorker(
  processor: () => Promise<unknown>
): Worker | null {
  const conn = getQueueConnection();
  if (!conn) return null;

  const worker = new Worker(QUEUE_NAME, async () => processor(), {
    connection: conn,
    concurrency: 1,
  });

  worker.on("completed", (job, result) => {
    logger.info(
      { jobId: job.id, result },
      "[cleanup] Storage cleanup job completed"
    );
  });

  worker.on("failed", (job, err) => {
    logger.error({ jobId: job?.id, err }, "[cleanup] Storage cleanup job failed");
  });

  return worker;
}
