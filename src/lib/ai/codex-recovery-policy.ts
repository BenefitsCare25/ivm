export type CodexWorkerState = "starting" | "ready" | "recovering" | "reconnect" | "offline";
export interface CodexWorkerHealth {
  state: CodexWorkerState;
  updatedAt: number;
  lastVerifiedAt: number | null;
  lastInferenceAt: number | null;
  retryAt: number;
  failureCode?: string;
  processes?: number;
  rssBytes?: number;
  descriptors?: number;
}

export function validWorkerHealth(value: unknown, now = Date.now()): CodexWorkerHealth {
  const health = value as Partial<CodexWorkerHealth> | null;
  if (!health || !["starting", "ready", "recovering", "reconnect"].includes(health.state ?? "") ||
      typeof health.updatedAt !== "number" || now - health.updatedAt > 45_000 || health.updatedAt > now + 5_000 ||
      (health.state === "ready" && (typeof health.lastVerifiedAt !== "number" || now - health.lastVerifiedAt > 120_000 || typeof health.lastInferenceAt !== "number"))) {
    return { state: "offline", updatedAt: 0, lastVerifiedAt: null, lastInferenceAt: null, retryAt: 0 };
  }
  return health as CodexWorkerHealth;
}

export function aiRecoveryDecision(previousAttempts = 0): { attempts: number; exhausted: boolean; delayMs: number } {
  const attempts = previousAttempts + 1;
  return { attempts, exhausted: attempts >= 3, delayMs: Math.min(300_000, 30_000 * 2 ** Math.min(attempts - 1, 4)) };
}
