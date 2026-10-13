import { DelayedError, type Job } from "bullmq";
import type { AppError } from "@/lib/errors";
import { aiRecoveryDecision } from "@/lib/ai/codex-recovery-policy";
import type { ItemEventType } from "@/types/portal";
import type { ItemDetailJobData, ItemDetailJobResult } from "./item-detail-queue";

export interface ClaimRetryState {
  status: "RETRYING" | "ERROR";
  errorMessage: string;
  aiRecoveryAttempts: number;
  retryAt: Date | null;
}

interface ClaimRetryDependencies {
  timeoutMs: number;
  pauseAdmission(error: AppError): Promise<void>;
  save(state: ClaimRetryState): Promise<boolean>;
  emit(eventType: ItemEventType, payload: Record<string, unknown>): Promise<void>;
  syncProgress(): Promise<void>;
  now?: () => number;
}

/** Called only after the claim's AI process tree has finished shutting down. */
export async function scheduleClaimAiRetry(
  job: Pick<Job<ItemDetailJobData>, "data" | "token" | "updateData" | "moveToDelayed">,
  error: AppError,
  dependencies: ClaimRetryDependencies,
): Promise<ItemDetailJobResult> {
  await dependencies.pauseAdmission(error);
  const decision = aiRecoveryDecision(job.data.aiRecoveryAttempts);
  const reason = error.code === "CODEX_TURN_TIMEOUT"
    ? `AI review timed out after ${Math.ceil(dependencies.timeoutMs / 60_000)} minutes.`
    : "The AI service interrupted this review.";
  if (decision.exhausted) {
    const message = `${reason} Automatic retries stopped after ${decision.attempts} attempts. Downloaded documents are preserved; retry after AI recovery.`;
    if (await dependencies.save({ status: "ERROR", errorMessage: message, aiRecoveryAttempts: decision.attempts, retryAt: null })) {
      await dependencies.emit("AI_RETRY_EXHAUSTED", { errorCode: error.code, errorMessage: message, attempts: decision.attempts });
      await dependencies.syncProgress();
    }
    return { status: "FAILED", mismatchCount: 0, errorMessage: message };
  }
  const retryAt = (dependencies.now ?? Date.now)() + decision.delayMs;
  await job.updateData({ ...job.data, aiRecoveryAttempts: decision.attempts, resumeDownloaded: true });
  const message = `${reason} Automatic retry queued. Downloaded documents are preserved.`;
  const saved = await dependencies.save({ status: "RETRYING", errorMessage: message, aiRecoveryAttempts: decision.attempts, retryAt: new Date(retryAt) });
  // A removed/cancelled claim must never be revived by a late error callback.
  if (!saved) return { status: "COMPLETED", mismatchCount: 0 };
  await dependencies.emit("AI_RETRY_SCHEDULED", {
    errorCode: error.code, errorMessage: reason, attempt: decision.attempts + 1, maxAttempts: 3, retryAt: new Date(retryAt).toISOString(),
  });
  await dependencies.syncProgress();
  await job.moveToDelayed(retryAt, job.token);
  throw new DelayedError();
}
