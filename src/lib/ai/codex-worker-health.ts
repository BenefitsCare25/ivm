import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { getRedisClient } from "@/lib/redis";
import { getCodexAccountStatus, getCodexResources, listCodexModels, runCodexTurn, withCodexClaim } from "./codex-app-server";
import { validWorkerHealth, aiRecoveryDecision, type CodexWorkerHealth } from "./codex-recovery-policy";
export { validWorkerHealth } from "./codex-recovery-policy";
export type { CodexWorkerHealth } from "./codex-recovery-policy";

const KEY = "ivm:codex:detail-worker:health";
export async function readCodexWorkerHealth(): Promise<CodexWorkerHealth> {
  try {
    const value = await getRedisClient()?.get(KEY);
    return validWorkerHealth(value ? JSON.parse(value) : null);
  } catch { return validWorkerHealth(null); }
}

export async function assertCodexWorkerReady(): Promise<void> {
  const health = await readCodexWorkerHealth();
  if (health.state !== "ready") throw new AppError(
    health.state === "reconnect" ? "ChatGPT login requires reconnection. Queued claims are preserved." : "Waiting for AI recovery. Queued claims are preserved.",
    503, health.state === "reconnect" ? "CODEX_NOT_CONNECTED" : "CODEX_RECOVERING",
  );
}

let local: CodexWorkerHealth = { state: "starting", updatedAt: Date.now(), lastVerifiedAt: null, lastInferenceAt: null, retryAt: 0 };
let failures = 0;
let revision = 0;
let running = false;
let checking = false;
let timer: ReturnType<typeof setInterval> | undefined;
let lastResourceLog = 0;
let inferenceController: AbortController | undefined;

async function publish(): Promise<void> {
  const resources = getCodexResources();
  local.updatedAt = Date.now();
  local.processes = resources.length;
  local.rssBytes = resources.reduce((sum, p) => sum + p.rssBytes, 0);
  local.descriptors = resources.reduce((sum, p) => sum + p.descriptors, 0);
  if (Date.now() - lastResourceLog >= 60_000) {
    logger.info({ state: local.state, resources, lastInferenceAt: local.lastInferenceAt }, "[codex] Worker health and resource usage");
    lastResourceLog = Date.now();
  }
  try { await getRedisClient()?.set(KEY, JSON.stringify(local), "EX", 45); }
  catch { logger.warn("[codex] Unable to publish worker heartbeat"); }
}

export async function markCodexWorkerFailure(error: AppError): Promise<void> {
  revision++;
  failures++;
  local.state = error.code === "CODEX_NOT_CONNECTED" ? "reconnect" : "recovering";
  local.failureCode = error.code;
  local.retryAt = Date.now() + aiRecoveryDecision(failures - 1).delayMs;
  logger.warn({ code: error.code, retryAt: local.retryAt }, "[codex] Claim admission paused for AI recovery");
  await publish();
}

async function probe(): Promise<void> {
  if (checking || !running || Date.now() < local.retryAt) return;
  checking = true;
  const startedRevision = revision;
  try {
    const account = await getCodexAccountStatus(true);
    if (!account.connected) throw new AppError("ChatGPT account unavailable", 503, account.errorCode ?? "CODEX_NOT_CONNECTED");
    const models = await listCodexModels();
    if (!models.some((model) => model.id === env.CODEX_REVIEW_MODEL)) throw new AppError("ChatGPT model unavailable", 503, "CODEX_MODEL_UNAVAILABLE");
    // Startup/recovery must prove inference works, not only read cached login metadata.
    if (local.state !== "ready") {
      inferenceController = new AbortController();
      const result = await withCodexClaim(AbortSignal.any([AbortSignal.timeout(45_000), inferenceController.signal]), () => runCodexTurn({
        systemPrompt: 'Reply with exactly {"status":"ok"}. Do not use tools.', userPrompt: "Connection health check.", effort: "low",
      }));
      let inferenceStatus: unknown;
      try { inferenceStatus = JSON.parse(result.text).status; } catch { /* rejected below */ }
      if (inferenceStatus !== "ok") throw new AppError("ChatGPT inference check failed", 503, "CODEX_UNAVAILABLE");
      local.lastInferenceAt = Date.now();
    }
    if (revision !== startedRevision || !running) return;
    local.state = "ready";
    local.failureCode = undefined;
    local.lastVerifiedAt = Date.now();
    local.retryAt = Date.now() + 60_000;
    failures = 0;
  } catch (error) {
    if (revision === startedRevision && running) await markCodexWorkerFailure(error instanceof AppError ? error : new AppError("ChatGPT health check failed", 503, "CODEX_UNAVAILABLE"));
  } finally { inferenceController = undefined; checking = false; if (running) await publish(); }
}

export function startCodexWorkerHealth(): void {
  if (env.AI_PROVIDER !== "codex" || running) return;
  running = true;
  void publish().then(() => probe());
  timer = setInterval(() => { void publish(); void probe(); }, 10_000);
  timer.unref();
}

export async function stopCodexWorkerHealth(): Promise<void> {
  running = false;
  revision++;
  inferenceController?.abort(new Error("Worker shutting down"));
  if (timer) clearInterval(timer);
  local.state = "offline";
  await publish();
}
