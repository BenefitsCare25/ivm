import { randomUUID } from "node:crypto";
import { DelayedError, Queue, Worker, Job } from "bullmq";
import { getQueueConnection } from "./connection";
import { logger } from "@/lib/logger";
import { env } from "@/lib/env";

const QUEUE_NAME = "item-detail";

// Max time a single item job may run before being timed out by BullMQ stall detection.
// Must be longer than the slowest possible job (Playwright + AI extraction + AI comparison).
const LOCK_DURATION_MS = 10 * 60 * 1000; // 10 minutes
const SESSION_LOCK_TTL_MS = LOCK_DURATION_MS + 60_000;
const SESSION_RETRY_DELAY_MS = 1_000;
const SESSION_LOCK_PREFIX = `${QUEUE_NAME}:session:`;
const RELEASE_SESSION_LOCK_SCRIPT = `
  if redis.call("get", KEYS[1]) == ARGV[1] then
    return redis.call("del", KEYS[1])
  end
  return 0
`;

export interface ItemDetailJobData {
  trackedItemId: string;
  portalId: string;
  scrapeSessionId: string;
  userId: string;
}

export interface ItemDetailJobResult {
  status: "COMPLETED" | "FAILED";
  mismatchCount: number;
  errorMessage?: string;
}

let itemDetailQueue: Queue<ItemDetailJobData, ItemDetailJobResult> | null = null;

interface SessionLock {
  key: string;
  token: string;
}

async function acquireSessionLock(
  scrapeSessionId: string,
): Promise<SessionLock | null> {
  const connection = getQueueConnection();
  if (!connection) return null;

  const key = `${SESSION_LOCK_PREFIX}${scrapeSessionId}`;
  const token = randomUUID();
  const acquired = await connection.set(
    key,
    token,
    "PX",
    SESSION_LOCK_TTL_MS,
    "NX",
  );

  return acquired === "OK" ? { key, token } : null;
}

async function releaseSessionLock(lock: SessionLock): Promise<void> {
  const connection = getQueueConnection();
  if (!connection) return;

  await connection.eval(
    RELEASE_SESSION_LOCK_SCRIPT,
    1,
    lock.key,
    lock.token,
  );
}

async function deferForActiveSession(
  job: Job<ItemDetailJobData>,
  scrapeSessionId: string,
): Promise<never> {
  const delayMs = SESSION_RETRY_DELAY_MS + Math.floor(Math.random() * 250);
  await job.moveToDelayed(Date.now() + delayMs, job.token);
  logger.debug(
    { jobId: job.id, scrapeSessionId, delayMs },
    "[queue] Deferred claim because its session is already processing another claim",
  );
  throw new DelayedError();
}

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

  const sessionAwareProcessor = async (
    job: Job<ItemDetailJobData>,
  ): Promise<ItemDetailJobResult> => {
    // Legacy queued jobs created before scrapeSessionId was added are scoped by
    // portal. The app permits only one active session per portal, so this keeps
    // the same one-claim-at-a-time guarantee during rolling deployments.
    const scrapeSessionId =
      job.data.scrapeSessionId || `legacy-portal:${job.data.portalId}`;
    const sessionLock = await acquireSessionLock(scrapeSessionId);
    if (!sessionLock) {
      return deferForActiveSession(job, scrapeSessionId);
    }

    try {
      return await processor(job);
    } finally {
      try {
        await releaseSessionLock(sessionLock);
      } catch (err) {
        logger.error(
          { err, scrapeSessionId, jobId: job.id },
          "[queue] Failed to release detail-session lock",
        );
      }
    }
  };

  const worker = new Worker<ItemDetailJobData, ItemDetailJobResult>(
    QUEUE_NAME,
    sessionAwareProcessor,
    {
      connection: conn,
      concurrency: env.DETAIL_WORKER_CONCURRENCY,
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
