import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import type { ItemEventType } from "@/types/portal";

/**
 * Records a structured event for a tracked item.
 * Fire-and-forget — never throws (errors are logged, not propagated).
 * Workers call this at each processing stage for observability.
 */
export async function emitItemEvent(
  trackedItemId: string,
  eventType: ItemEventType,
  payload: Record<string, unknown> = {},
  options?: { screenshotPath?: string; durationMs?: number }
): Promise<void> {
  try {
    await db.trackedItemEvent.create({
      data: {
        trackedItemId,
        eventType,
        payload: JSON.parse(JSON.stringify(payload)),
        screenshotPath: options?.screenshotPath ?? null,
        durationMs: options?.durationMs ?? null,
      },
    });
  } catch (err) {
    logger.warn({ err, trackedItemId, eventType }, "[events] Failed to emit event");
  }
}

/**
 * Captures a screenshot on failure and emits an error event.
 * Stores screenshot via StorageAdapter and records the path in the event payload.
 */
export async function emitFailureEvent(
  trackedItemId: string,
  eventType: ItemEventType,
  error: unknown,
  screenshot?: Buffer
): Promise<void> {
  let screenshotPath: string | undefined;

  if (screenshot) {
    try {
      const { getStorageAdapter } = await import("@/lib/storage");
      const storage = getStorageAdapter();
      const timestamp = Date.now();
      screenshotPath = `portal-events/${trackedItemId}/${eventType}-${timestamp}.png`;
      await storage.upload(screenshotPath, screenshot, "image/png");
    } catch (uploadErr) {
      logger.warn({ uploadErr, trackedItemId }, "[events] Failed to upload failure screenshot");
    }
  }

  const errorMessage = error instanceof Error ? error.message : String(error);
  const errorStack = error instanceof Error
    ? error.stack?.split("\n").slice(0, 4).join("\n")
    : undefined;

  await emitItemEvent(
    trackedItemId,
    eventType,
    { errorMessage, ...(errorStack ? { errorStack } : {}) },
    { screenshotPath }
  );
}

/**
 * Times an async operation and emits start/done/fail events automatically.
 * On failure, optionally captures a screenshot before re-throwing.
 */
export async function withEventTracking<T>(
  trackedItemId: string,
  startType: ItemEventType,
  doneType: ItemEventType,
  failType: ItemEventType,
  startPayload: Record<string, unknown>,
  fn: () => Promise<T>,
  captureScreenshot?: () => Promise<Buffer | undefined>
): Promise<T> {
  await emitItemEvent(trackedItemId, startType, startPayload);
  const t0 = Date.now();

  try {
    const result = await fn();
    await emitItemEvent(trackedItemId, doneType, startPayload, { durationMs: Date.now() - t0 });
    return result;
  } catch (err) {
    const screenshot = captureScreenshot
      ? await captureScreenshot().catch(() => undefined)
      : undefined;
    await emitFailureEvent(trackedItemId, failType, err, screenshot);
    throw err;
  }
}
