import { Queue, Worker, Job } from "bullmq";
import { getQueueConnection } from "./connection";
import { logger } from "@/lib/logger";

const QUEUE_NAME = "item-detail";

export interface ItemDetailJobData {
  trackedItemId: string;
  portalId: string;
  userId: string;
}

export interface ItemDetailJobResult {
  status: "COMPLETED" | "FAILED";
  mismatchCount: number;
  errorMessage?: string;
}

let itemDetailQueue: Queue<ItemDetailJobData, ItemDetailJobResult> | null = null;

export function getItemDetailQueue(): Queue<ItemDetailJobData, ItemDetailJobResult> | null {
  const conn = getQueueConnection();
  if (!conn) return null;

  if (!itemDetailQueue) {
    itemDetailQueue = new Queue<ItemDetailJobData, ItemDetailJobResult>(QUEUE_NAME, {
      connection: conn,
      defaultJobOptions: {
        attempts: 2,
        backoff: { type: "exponential", delay: 3000 },
        removeOnComplete: { count: 200 },
        removeOnFail: { count: 100 },
      },
    });
  }

  return itemDetailQueue;
}

export async function enqueueItemDetail(
  data: ItemDetailJobData
): Promise<string | null> {
  const queue = getItemDetailQueue();
  if (!queue) return null;

  const job = await queue.add("process-item", data, {
    jobId: `item:${data.trackedItemId}:${Date.now()}`,
  });

  return job.id ?? null;
}

export async function enqueueItemDetailBatch(
  items: ItemDetailJobData[]
): Promise<number> {
  const queue = getItemDetailQueue();
  if (!queue) return 0;

  const jobs = items.map((data) => ({
    name: "process-item",
    data,
    opts: { jobId: `item:${data.trackedItemId}:${Date.now()}` },
  }));

  await queue.addBulk(jobs);
  logger.info({ count: items.length }, "[queue] Item detail jobs enqueued in batch");
  return items.length;
}

export function startItemDetailWorker(
  processor: (job: Job<ItemDetailJobData>) => Promise<ItemDetailJobResult>
): Worker<ItemDetailJobData, ItemDetailJobResult> | null {
  const conn = getQueueConnection();
  if (!conn) return null;

  const worker = new Worker<ItemDetailJobData, ItemDetailJobResult>(
    QUEUE_NAME,
    processor,
    { connection: conn, concurrency: 2 }
  );

  worker.on("completed", (job) => {
    logger.info({ jobId: job.id, trackedItemId: job.data.trackedItemId }, "[queue] Item detail job completed");
  });

  worker.on("failed", (job, err) => {
    logger.error({ jobId: job?.id, err }, "[queue] Item detail job failed");
  });

  return worker;
}
