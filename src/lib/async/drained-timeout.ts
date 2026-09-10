export class DrainedTaskTimeoutError extends Error {
  constructor(label: string, timeoutMs: number) {
    super(`Timed out after ${timeoutMs / 1000}s: ${label}`);
    this.name = "DrainedTaskTimeoutError";
  }
}

type TaskOutcome<T> =
  | { kind: "completed"; value: T }
  | { kind: "failed"; error: Error };

function asError(reason: unknown, fallback: string): Error {
  return reason instanceof Error ? reason : new Error(fallback);
}

/**
 * Abort a timed-out/cancelled task, but do not settle until its underlying
 * promise has finished cleanup. This keeps callers' concurrency slots occupied
 * while resource-heavy work is still alive.
 */
export async function runWithDrainedTimeout<T>(
  task: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  label: string,
  upstreamSignal?: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  let removeUpstreamListener: (() => void) | undefined;

  const cancellation = new Promise<{ kind: "cancelled"; error: Error }>((resolve) => {
    const cancel = (error: Error): void => {
      if (controller.signal.aborted) return;
      controller.abort(error);
      resolve({ kind: "cancelled", error });
    };

    timeoutHandle = setTimeout(() => {
      cancel(new DrainedTaskTimeoutError(label, timeoutMs));
    }, timeoutMs);

    if (upstreamSignal) {
      const relayAbort = (): void => {
        cancel(asError(upstreamSignal.reason, `Cancelled: ${label}`));
      };
      if (upstreamSignal.aborted) {
        relayAbort();
      } else {
        upstreamSignal.addEventListener("abort", relayAbort, { once: true });
        removeUpstreamListener = () =>
          upstreamSignal.removeEventListener("abort", relayAbort);
      }
    }
  });

  let runningTask: Promise<T>;
  try {
    runningTask = task(controller.signal);
  } catch (error) {
    runningTask = Promise.reject(error);
  }
  const taskOutcome: Promise<TaskOutcome<T>> = runningTask.then(
      (value) => ({ kind: "completed" as const, value }),
      (error: unknown) => ({
        kind: "failed" as const,
        error: asError(error, `Task failed: ${label}`),
      }),
  );

  try {
    const outcome = await Promise.race([taskOutcome, cancellation]);
    if (outcome.kind === "cancelled") {
      await taskOutcome;
      throw outcome.error;
    }
    if (outcome.kind === "failed") throw outcome.error;
    return outcome.value;
  } finally {
    if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
    removeUpstreamListener?.();
  }
}
