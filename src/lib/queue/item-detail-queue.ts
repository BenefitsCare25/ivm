import { Queue, Worker, Job } from "bullmq";
import { getQueueConnection } from "./connection";
import { logger } from "@/lib/logger";

const QUEUE_NAME = "item-detail";

// Max time a single item job may run before being timed out by BullMQ stall detection.
// Must be longer than the slowest possible job (Playwright + AI extraction + AI comparison).
const LOCK_DURATION_MS = 5 * 60 * 1000; // 5 minutes

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
        backoff: { type: "exponential", delay: 5000 },
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

  // Stable jobId (no timestamp) — deduplicates if same item is enqueued twice
  const job = await queue.add("process-item", data, {
    jobId: `item_${data.trackedItemId}`,
  });

  return job.id ?? null;
}

export async function enqueueItemDetailBatch(
  items: ItemDetailJobData[],
  opts?: { reprocess?: boolean }
): Promise<number> {
  const queue = getItemDetailQueue();
  if (!queue) return 0;

  // For reprocess (retry/continue), remove any existing terminal jobs with the
  // same stable ID first. BullMQ silently drops addBulk entries whose jobId
  // already exists (even in completed/failed state), so without removal the
  // re-enqueue would be a no-op.
  if (opts?.reprocess) {
    await Promise.allSettled(
      items.map(async (data) => {
        const existing = await queue.getJob(`item_${data.trackedItemId}`);
        if (existing) {
          const state = await existing.getState();
          if (state === "completed" || state === "failed" || state === "unknown") {
            await existing.remove();
          }
        }
      })
    );
  }

  const jobs = items.map((data) => ({
    name: "process-item",
    data,
    opts: {
      // Stable jobId deduplicates concurrent initial enqueues.
      // For reprocess runs the old job has been removed above.
      jobId: `item_${data.trackedItemId}`,
    },
  }));

  await queue.addBulk(jobs);
  logger.info({ count: items.length, reprocess: !!opts?.reprocess }, "[queue] Item detail jobs enqueued in batch");
  return items.length;
}

export function startItemDetailWorker(
  processor: (job: Job<ItemDetailJobData>) => Promise<ItemDetailJobResult>,
  onFinalFailure?: (job: Job<ItemDetailJobData>, err: Error) => Promise<void>
): Worker<ItemDetailJobData, ItemDetailJobResult> | null {
  const conn = getQueueConnection();
  if (!conn) return null;

  const worker = new Worker<ItemDetailJobData, ItemDetailJobResult>(
    QUEUE_NAME,
    processor,
    {
      connection: conn,
      concurrency: 3,
      // Long lock so BullMQ doesn't stall-detect jobs mid-AI-call
      lockDuration: LOCK_DURATION_MS,
      // Check for stalled jobs every 30 seconds
      stalledInterval: 30_000,
      // Allow each job to stall at most once before marking failed
      maxStalledCount: 1,
    }
  );

  worker.on("completed", (job) => {
    logger.info(
      { jobId: job.id, trackedItemId: job.data.trackedItemId },
      "[queue] Item detail job completed"
    );
  });

  worker.on("failed", async (job, err) => {
    logger.error({ jobId: job?.id, err }, "[queue] Item detail job failed");
    // On final retry exhaustion, ensure DB reflects ERROR state
    if (job && job.attemptsMade >= (job.opts.attempts ?? 1)) {
      await onFinalFailure?.(job, err);
    }
  });

  worker.on("stalled", (jobId) => {
    logger.warn({ jobId }, "[queue] Item detail job stalled — will be re-queued");
  });

  return worker;
}
