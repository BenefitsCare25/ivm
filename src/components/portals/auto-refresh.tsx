"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";

export function AutoRefresh({ intervalMs = 5000 }: { intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const interval = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(interval);
  }, [router, intervalMs]);

  return (
    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <RefreshCw className="h-3 w-3 animate-spin" />
      Live
    </span>
  );
}
