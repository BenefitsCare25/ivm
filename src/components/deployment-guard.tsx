"use client";

import { useEffect } from "react";

/**
 * Detects stale client JS after a server redeploy and reloads the page.
 *
 * After every deployment, Next.js server action IDs change. If the browser
 * still has the old JS bundle loaded, any server action call will fail with
 * "Failed to find Server Action". This guard catches that error and reloads
 * once so the browser picks up the new bundle — transparently to the user.
 */
export function DeploymentGuard() {
  useEffect(() => {
    const handleError = (event: ErrorEvent) => {
      if (isStaleDeploymentError(event.message)) {
        reload();
      }
    };

    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      const message =
        typeof event.reason === "string"
          ? event.reason
          : event.reason?.message ?? "";
      if (isStaleDeploymentError(message)) {
        reload();
      }
    };

    window.addEventListener("error", handleError);
    window.addEventListener("unhandledrejection", handleUnhandledRejection);

    return () => {
      window.removeEventListener("error", handleError);
      window.removeEventListener("unhandledrejection", handleUnhandledRejection);
    };
  }, []);

  return null;
}

function isStaleDeploymentError(message: string): boolean {
  return (
    message.includes("Failed to find Server Action") ||
    message.includes("This request might be from an older or newer deployment")
  );
}

function reload() {
  // Guard against reload loops: only reload once per 30s
  const RELOAD_KEY = "ivm_deployment_reload";
  const last = Number(sessionStorage.getItem(RELOAD_KEY) ?? 0);
  if (Date.now() - last < 30_000) return;
  sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  window.location.reload();
}
