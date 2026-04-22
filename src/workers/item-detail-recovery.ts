import { Job } from "bullmq";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import {
  enqueueItemDetailBatch,
  getItemDetailQueue,
  type ItemDetailJobData,
} from "@/lib/queue/item-detail-queue";

export async function recoverStuckItems(): Promise<void> {
  const stuck = await db.trackedItem.findMany({
    where: { status: "PROCESSING" },
    select: {
      id: true,
      scrapeSession: {
        select: {
          portalId: true,
          portal: { select: { userId: true } },
        },
      },
    },
  });

  if (stuck.length === 0) return;

  logger.warn({ count: stuck.length }, "[worker] Recovering stuck PROCESSING items");

  const erroredItemIds = await db.trackedItemEvent.findMany({
    where: {
      trackedItemId: { in: stuck.map((s) => s.id) },
      eventType: "ITEM_ERROR",
    },
    select: { trackedItemId: true },
  }).then((events) => new Set(events.map((e) => e.trackedItemId)));

  const toRetry = stuck.filter((s) => !erroredItemIds.has(s.id));
  const toError = stuck.filter((s) => erroredItemIds.has(s.id));

  if (toError.length > 0) {
    logger.warn({ count: toError.length, ids: toError.map((s) => s.id) },
      "[worker] Setting previously-errored PROCESSING items to ERROR");
    await db.trackedItem.updateMany({
      where: { id: { in: toError.map((s) => s.id) } },
      data: { status: "ERROR", errorMessage: "Worker restarted after error" },
    });
  }

  if (toRetry.length > 0) {
    logger.warn({ count: toRetry.length }, "[worker] Re-enqueuing genuinely stuck items");
    await db.trackedItem.updateMany({
      where: { id: { in: toRetry.map((s) => s.id) } },
      data: { status: "DISCOVERED", errorMessage: null },
    });
    await enqueueItemDetailBatch(
      toRetry.map((item) => ({
        trackedItemId: item.id,
        portalId: item.scrapeSession.portalId,
        userId: item.scrapeSession.portal.userId,
      })),
      { reprocess: true }
    );
  }

  await recoverOrphanedDiscoveredItems();
}

async function recoverOrphanedDiscoveredItems(): Promise<void> {
  const queue = getItemDetailQueue();
  if (!queue) return;

  const discovered = await db.trackedItem.findMany({
    where: { status: "DISCOVERED" },
    select: {
      id: true,
      scrapeSession: {
        select: {
          portalId: true,
          portal: { select: { userId: true } },
        },
      },
    },
  });

  if (discovered.length === 0) return;

  const orphaned = (
    await Promise.all(
      discovered.map(async (item) => {
        const job = await queue.getJob(`item_${item.id}`);
        if (!job) return item;
        const state = await job.getState();
        return state === "completed" || state === "failed" || state === "unknown" ? item : null;
      })
    )
  ).filter(Boolean) as typeof discovered;

  if (orphaned.length === 0) return;

  logger.warn({ count: orphaned.length }, "[worker] Re-enqueuing orphaned DISCOVERED items with no BullMQ job");
  await enqueueItemDetailBatch(
    orphaned.map((item) => ({
      trackedItemId: item.id,
      portalId: item.scrapeSession.portalId,
      userId: item.scrapeSession.portal.userId,
    })),
    { reprocess: true }
  );
}

export async function handleFinalFailure(
  job: Job<ItemDetailJobData>,
  err: Error
): Promise<void> {
  try {
    await db.trackedItem.updateMany({
      where: { id: job.data.trackedItemId, status: "PROCESSING" },
      data: { status: "ERROR", errorMessage: err.message },
    });
  } catch (dbErr) {
    logger.error({ dbErr, trackedItemId: job.data.trackedItemId }, "[worker] Failed to update ERROR status on final failure");
  }
}
