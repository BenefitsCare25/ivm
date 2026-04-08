import { Queue, Worker, QueueEvents, Job } from "bullmq";
import { getQueueConnection } from "./connection";
import { logger } from "@/lib/logger";

const QUEUE_NAME = "portal-scrape";

export interface PortalScrapeJobData {
  portalId: string;
  scrapeSessionId: string;
  userId: string;
}

export interface PortalScrapeJobResult {
  status: "COMPLETED" | "FAILED";
  itemsFound: number;
  errorMessage?: string;
}

let portalScrapeQueue: Queue<PortalScrapeJobData, PortalScrapeJobResult> | null = null;
let queueEvents: QueueEvents | null = null;

export function getPortalScrapeQueue(): Queue<PortalScrapeJobData, PortalScrapeJobResult> | null {
  const conn = getQueueConnection();
  if (!conn) return null;

  if (!portalScrapeQueue) {
    portalScrapeQueue = new Queue<PortalScrapeJobData, PortalScrapeJobResult>(QUEUE_NAME, {
      connection: conn,
      defaultJobOptions: {
        attempts: 1,
        removeOnComplete: { count: 50 },
        removeOnFail: { count: 50 },
      },
    });
  }

  return portalScrapeQueue;
}

export function getPortalScrapeQueueEvents(): QueueEvents | null {
  const conn = getQueueConnection();
  if (!conn) return null;

  if (!queueEvents) {
    queueEvents = new QueueEvents(QUEUE_NAME, { connection: { url: process.env.REDIS_URL! } });
  }

  return queueEvents;
}

export async function enqueuePortalScrape(
  data: PortalScrapeJobData
): Promise<string | null> {
  const queue = getPortalScrapeQueue();
  if (!queue) return null;

  const job = await queue.add("scrape", data, {
    jobId: `scrape:${data.portalId}:${Date.now()}`,
  });

  logger.info(
    { jobId: job.id, portalId: data.portalId, scrapeSessionId: data.scrapeSessionId },
    "[queue] Portal scrape job enqueued"
  );

  return job.id ?? null;
}

export function startPortalScrapeWorker(
  processor: (job: Job<PortalScrapeJobData>) => Promise<PortalScrapeJobResult>
): Worker<PortalScrapeJobData, PortalScrapeJobResult> | null {
  const conn = getQueueConnection();
  if (!conn) return null;

  const worker = new Worker<PortalScrapeJobData, PortalScrapeJobResult>(
    QUEUE_NAME,
    processor,
    { connection: conn, concurrency: 1 }
  );

  worker.on("completed", (job) => {
    logger.info({ jobId: job.id, portalId: job.data.portalId }, "[queue] Portal scrape job completed");
  });

  worker.on("failed", (job, err) => {
    logger.error({ jobId: job?.id, err }, "[queue] Portal scrape job failed");
  });

  return worker;
}
