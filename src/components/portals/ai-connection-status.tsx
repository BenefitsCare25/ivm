"use client";

import { CheckCircle2, CircleAlert, Loader2, Plug, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ChatGptStatus } from "@/components/settings/use-chatgpt-status";

export interface AIConnectionState {
  kind: "checking" | "connected" | "error" | "api";
  label: string;
  message: string;
  blocked: boolean;
}

export function getAIConnectionState(
  selection: string | null,
  status: ChatGptStatus | null,
  checking: boolean,
): AIConnectionState {
  if (selection) return {
    kind: "api", label: "API model selected", blocked: false,
    message: "Uses the selected API connection. API usage may be billed by its provider. ChatGPT status does not validate this API connection.",
  };
  if (checking) return {
    kind: "checking", label: "Checking ChatGPT", blocked: true,
    message: "Verifying authorization and model access before processing claims.",
  };
  if (!status) return {
    kind: "error", label: "Connection not verified", blocked: true,
    message: "Unable to verify ChatGPT. Default processing is blocked. Check again or contact an administrator. No API fallback will be used.",
  };
  if (!status.configured) return {
    kind: "api", label: "Default uses API settings", blocked: false,
    message: "ChatGPT is not the deployment default. Processing uses the saved API settings; provider charges may apply.",
  };
  if (!status.connected) return {
    kind: "error", label: "ChatGPT connection lost", blocked: true,
    message: "Default processing is blocked. Ask an administrator to reconnect ChatGPT. No API fallback will be used.",
  };
  if (!status.selectedModelAvailable) return {
    kind: "error", label: "ChatGPT model unavailable", blocked: true,
    message: "Authorization is valid, but model access could not be verified. Default processing is blocked. Check again or ask an administrator to check the model. No API fallback will be used.",
  };
  return {
    kind: "connected", label: "ChatGPT connected", blocked: false,
    message: "Authorization and model access verified. Uses your ChatGPT plan. No API fallback.",
  };
}

const badgeStyles = {
  checking: "bg-muted text-muted-foreground",
  connected: "bg-status-success/10 text-[color:color-mix(in_srgb,rgb(var(--status-success)),rgb(var(--foreground))_30%)]",
  error: "bg-status-error/10 text-[color:color-mix(in_srgb,rgb(var(--status-error)),rgb(var(--foreground))_30%)]",
  api: "bg-status-warning/10 text-[color:color-mix(in_srgb,rgb(var(--status-warning)),rgb(var(--foreground))_30%)]",
};

export function AIConnectionBadge({ state }: { state: AIConnectionState }) {
  const Icon = state.kind === "checking" ? Loader2
    : state.kind === "connected" ? CheckCircle2
    : state.kind === "error" ? CircleAlert : Plug;
  return (
    <span role="status" aria-atomic="true" className={`inline-flex max-w-full items-center gap-1.5 rounded-full px-2.5 py-1 text-sm font-medium ${badgeStyles[state.kind]}`}>
      <Icon aria-hidden="true" className={`h-4 w-4 shrink-0 ${state.kind === "checking" ? "animate-spin motion-reduce:animate-none" : ""}`} />
      <span>{state.label}</span>
    </span>
  );
}

export function AIConnectionStatus({ state, onRefresh }: {
  state: AIConnectionState;
  onRefresh: () => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <AIConnectionBadge state={state} />
        {state.kind !== "api" && (
          <Button variant="ghost" size="sm" onClick={onRefresh} disabled={state.kind === "checking"} aria-label="Check AI connection">
            <RefreshCw aria-hidden="true" className="mr-1.5 h-3.5 w-3.5" />
            {state.kind === "checking" ? "Checking" : "Check now"}
          </Button>
        )}
      </div>
      {(state.kind === "error" || state.kind === "api") && (
        <p className={`text-sm ${state.kind === "error" ? "text-status-error" : "text-muted-foreground"}`}>
          {state.message}
        </p>
      )}
    </div>
  );
}
