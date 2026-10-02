"use client";

import { Bot, CheckCircle, Loader2, XCircle } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useChatGptStatus } from "./use-chatgpt-status";

export function ChatGptStatusCard() {
  const { status, loading, refresh } = useChatGptStatus();

  const healthy = Boolean(status?.configured && status.connected && status.selectedModelAvailable);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Bot className="h-4 w-4 text-muted-foreground" />
            <div>
              <h3 className="text-sm font-medium text-foreground">ChatGPT deployment connection</h3>
              <p className="text-xs text-muted-foreground">
                Checked every 30 seconds. Default processing stops if this connection is lost.
              </p>
            </div>
          </div>
          {loading ? (
            <span className="flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" /> Checking
            </span>
          ) : healthy ? (
            <span className="flex items-center gap-1 rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-500">
              <CheckCircle className="h-3 w-3" /> Authorized
            </span>
          ) : (
            <span className="flex items-center gap-1 rounded-full bg-red-500/10 px-2.5 py-1 text-xs font-medium text-red-500">
              <XCircle className="h-3 w-3" /> Connection unavailable
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3 pb-4">
        {status && (
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs">
            <Detail label="Plan" value={status.planType ?? "Not detected"} />
            <Detail label="Model" value={status.model} />
            <Detail label="Reasoning" value={status.reasoningEffort} />
            <Detail label="Authorization" value="Server only" />
          </div>
        )}
        {!loading && !healthy && (
          <div role="status" className="space-y-2">
            <p className="text-sm text-status-error">
              {status?.message ?? "Unable to verify the ChatGPT connection. Default processing is blocked until its status can be checked."}
            </p>
            <Button variant="outline" size="sm" onClick={refresh}>Check again</Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-muted-foreground">{label}:</span>
      <span className="font-medium text-foreground">{value}</span>
    </div>
  );
}
