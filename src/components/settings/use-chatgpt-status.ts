"use client";

import { useCallback, useEffect, useState } from "react";

export interface ChatGptStatus {
  configured: boolean;
  connected: boolean;
  planType?: string;
  model: string;
  reasoningEffort: string;
  selectedModelAvailable: boolean;
  message: string | null;
}

export function useChatGptStatus() {
  const [status, setStatus] = useState<ChatGptStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);

  useEffect(() => {
    let stopped = false;
    let pending: AbortController | null = null;
    async function check() {
      if (pending || document.visibilityState === "hidden") return;
      const controller = new AbortController();
      pending = controller;
      setLoading(true);
      const timeout = window.setTimeout(() => controller.abort(), 35_000);
      try {
        const response = await fetch("/api/settings/chatgpt-status", {
          cache: "no-store", signal: controller.signal,
        });
        if (!response.ok) throw new Error("Connection status unavailable");
        const data: ChatGptStatus = await response.json();
        if (typeof data.configured !== "boolean" || typeof data.connected !== "boolean" ||
            typeof data.selectedModelAvailable !== "boolean" || typeof data.model !== "string") {
          throw new Error("Invalid connection status");
        }
        if (!stopped) {
          setStatus(data);
        }
      } catch {
        if (!stopped) {
          setStatus(null);
        }
      } finally {
        window.clearTimeout(timeout);
        pending = null;
        if (!stopped) setLoading(false);
      }
    }
    void check();
    const interval = window.setInterval(() => void check(), 30_000);
    const onFocus = () => void check();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      stopped = true;
      pending?.abort();
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [revision]);

  return { status, loading, refresh };
}
