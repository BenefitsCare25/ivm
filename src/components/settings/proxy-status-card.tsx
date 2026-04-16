"use client";

import { useEffect, useState } from "react";
import { Loader2, Zap, CheckCircle, XCircle, AlertCircle } from "lucide-react";
import { Card, CardHeader, CardContent } from "@/components/ui/card";

interface ProxyStatus {
  configured: boolean;
  healthy: boolean;
  model?: string;
}

export function ProxyStatusCard() {
  const [status, setStatus] = useState<ProxyStatus | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/settings/proxy-status")
      .then((r) => r.json())
      .then((d) => setStatus(d))
      .catch(() => setStatus({ configured: false, healthy: false }))
      .finally(() => setLoading(false));
  }, []);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-muted-foreground" />
            <div>
              <h3 className="text-sm font-medium text-foreground">Claude Pay Plan</h3>
              <p className="text-xs text-muted-foreground">
                System default — used when no personal API key is configured
              </p>
            </div>
          </div>
          <StatusBadge loading={loading} status={status} />
        </div>
      </CardHeader>

      <CardContent className="pb-4">
        {loading ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Checking connection...
          </div>
        ) : !status?.configured ? (
          <p className="text-xs text-muted-foreground">Proxy not configured on this server.</p>
        ) : (
          <div className="flex flex-wrap gap-x-6 gap-y-1">
            <Detail label="Model" value={status.model ?? "claude-sonnet-4-6"} />
            <Detail
              label="Status"
              value={status.healthy ? "Connected and ready" : "Unreachable — check VPS"}
              highlight={status.healthy ? "ok" : "err"}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function StatusBadge({ loading, status }: { loading: boolean; status: ProxyStatus | null }) {
  if (loading) {
    return (
      <span className="flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" /> Checking
      </span>
    );
  }
  if (!status?.configured) {
    return (
      <span className="flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">
        <AlertCircle className="h-3 w-3" /> Not configured
      </span>
    );
  }
  if (status.healthy) {
    return (
      <span className="flex items-center gap-1 rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-500">
        <CheckCircle className="h-3 w-3" /> Connected
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1 rounded-full bg-red-500/10 px-2.5 py-1 text-xs font-medium text-red-500">
      <XCircle className="h-3 w-3" /> Disconnected
    </span>
  );
}

function Detail({ label, value, highlight }: { label: string; value: string; highlight?: "ok" | "err" }) {
  const valueClass =
    highlight === "ok"
      ? "text-emerald-500"
      : highlight === "err"
      ? "text-red-400"
      : "text-foreground";
  return (
    <div className="flex items-center gap-1.5 text-xs">
      <span className="text-muted-foreground">{label}:</span>
      <span className={`font-medium ${valueClass}`}>{value}</span>
    </div>
  );
}
