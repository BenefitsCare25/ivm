import { Queue, Worker, QueueEvents, Job } from "bullmq";
import { getQueueConnection } from "./connection";

const QUEUE_NAME = "extraction";

export interface ExtractionJobData {
  sessionId: string;
  sourceAssetId: string;
  userId: string;
}

export interface ExtractionJobResult {
  extractionId: string;
  status: "COMPLETED" | "FAILED";
  errorMessage?: string;
}

let extractionQueue: Queue<ExtractionJobData, ExtractionJobResult> | null = null;
let queueEvents: QueueEvents | null = null;

export function getExtractionQueue(): Queue<ExtractionJobData, ExtractionJobResult> | null {
  const conn = getQueueConnection();
  if (!conn) return null;

  if (!extractionQueue) {
    extractionQueue = new Queue<ExtractionJobData, ExtractionJobResult>(QUEUE_NAME, {
      connection: conn,
      defaultJobOptions: {
        attempts: 2,
        backoff: { type: "exponential", delay: 2000 },
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 50 },
      },
    });
  }

  return extractionQueue;
}

export function getQueueEvents(): QueueEvents | null {
  const conn = getQueueConnection();
  if (!conn) return null;

  if (!queueEvents) {
    // QueueEvents needs its own Redis connection
    const url = process.env.REDIS_URL;
    if (!url) return null;
    queueEvents = new QueueEvents(QUEUE_NAME, { connection: { url } });
  }

  return queueEvents;
}

/**
 * Enqueues an extraction job and waits for it to complete (timeout: 90s).
 * Returns null if Redis is not configured (caller should fall back to inline).
 */
export async function enqueueAndWaitExtraction(
  data: ExtractionJobData
): Promise<ExtractionJobResult | null> {
  const queue = getExtractionQueue();
  if (!queue) return null;

  const events = getQueueEvents();
  if (!events) return null;

  const job = await queue.add("extract", data, {
    jobId: `extract:${data.sessionId}:${Date.now()}`,
  });

  const result = await job.waitUntilFinished(events, 90_000);
  return result as ExtractionJobResult;
}

/**
 * Starts the extraction worker. Called from a long-running process (not the Next.js server).
 */
export function startExtractionWorker(
  processor: (job: Job<ExtractionJobData>) => Promise<ExtractionJobResult>
): Worker<ExtractionJobData, ExtractionJobResult> | null {
  const conn = getQueueConnection();
  if (!conn) return null;

  const worker = new Worker<ExtractionJobData, ExtractionJobResult>(
    QUEUE_NAME,
    processor,
    { connection: conn, concurrency: 3 }
  );

  worker.on("completed", (job) => {
    console.log(`[queue] Job ${job.id} completed for session ${job.data.sessionId}`);
  });

  worker.on("failed", (job, err) => {
    console.error(`[queue] Job ${job?.id} failed:`, err.message);
  });

  return worker;
}
