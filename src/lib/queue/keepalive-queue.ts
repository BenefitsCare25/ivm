import { Queue, Worker } from "bullmq";
import { getQueueConnection } from "./connection";
import { logger } from "@/lib/logger";

const QUEUE_NAME = "portal-keepalive";
const DEFAULT_MINUTES = 15;

/**
 * Keep-alive OFF switch. Set PORTAL_KEEPALIVE_MINUTES to `off`/`false`/`0`/`-1`
 * to disable the sweep entirely — required for single-session portals where
 * pinging from the server evicts the user's own browser session.
 */
function isKeepAliveDisabled(): boolean {
  const raw = (process.env.PORTAL_KEEPALIVE_MINUTES ?? "").trim().toLowerCase();
  if (raw === "off" || raw === "false" || raw === "disabled") return true;
  const n = Number(raw);
  return Number.isFinite(n) && n <= 0;
}

/** Interval between keep-alive sweeps. Overridable via PORTAL_KEEPALIVE_MINUTES. */
function repeatEveryMs(): number {
  const raw = Number(process.env.PORTAL_KEEPALIVE_MINUTES);
  const minutes = Number.isFinite(raw) && raw >= 1 ? raw : DEFAULT_MINUTES;
  return minutes * 60 * 1000;
}

let keepAliveQueue: Queue | null = null;

export function getKeepAliveQueue(): Queue | null {
  const conn = getQueueConnection();
  if (!conn) return null;

  if (!keepAliveQueue) {
    keepAliveQueue = new Queue(QUEUE_NAME, {
      connection: conn,
      defaultJobOptions: {
        removeOnComplete: { count: 5 },
        removeOnFail: { count: 5 },
      },
    });
  }

  return keepAliveQueue;
}

export async function scheduleKeepAlive(): Promise<void> {
  const queue = getKeepAliveQueue();
  if (!queue) {
    logger.warn("[keepalive] Redis unavailable — portal keep-alive not scheduled");
    return;
  }

  // Drop stale repeatable jobs (e.g. an interval change from a prior deploy)
  // before re-adding, so only one schedule is ever active.
  const existing = await queue.getRepeatableJobs();
  for (const job of existing) {
    await queue.removeRepeatableByKey(job.key);
  }

  // Explicitly disabled — leave the schedule empty (jobs already removed above).
  if (isKeepAliveDisabled()) {
    logger.info("[keepalive] Portal keep-alive DISABLED via PORTAL_KEEPALIVE_MINUTES");
    return;
  }

  const every = repeatEveryMs();
  await queue.add(
    "keepalive",
    {},
    {
      repeat: { every },
      jobId: "portal-keepalive-repeat",
    }
  );

  logger.info({ everyMinutes: every / 60000 }, "[keepalive] Portal keep-alive scheduled");
}

export function startKeepAliveWorker(
  processor: () => Promise<unknown>
): Worker | null {
  const conn = getQueueConnection();
  if (!conn) return null;

  const worker = new Worker(QUEUE_NAME, async () => processor(), {
    connection: conn,
    concurrency: 1,
  });

  worker.on("completed", (job, result) => {
    logger.info({ jobId: job.id, result }, "[keepalive] Keep-alive sweep completed");
  });

  worker.on("failed", (job, err) => {
    logger.error({ jobId: job?.id, err }, "[keepalive] Keep-alive sweep failed");
  });

  return worker;
}
