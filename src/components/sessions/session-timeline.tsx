"use client";

import {
  Plus,
  Upload,
  Loader,
  CheckCircle,
  XCircle,
  Pencil,
  Target,
  Trash2,
  GitBranch,
  Eye,
  ThumbsUp,
  Play,
  CheckCircle2,
  Circle,
} from "lucide-react";
import { formatDate } from "@/lib/utils";
import { getEventLabel, getEventIconName, formatPayloadSummary } from "@/types/audit";
import type { AuditEventSummary } from "@/types/audit";

type LucideIcon = React.ElementType;

const ICON_MAP: Record<string, LucideIcon> = {
  Plus,
  Upload,
  Loader,
  CheckCircle,
  XCircle,
  Pencil,
  Target,
  Trash2,
  GitBranch,
  Eye,
  ThumbsUp,
  Play,
  CheckCircle2,
  Circle,
};

function getIconComponent(eventType: string): LucideIcon {
  return ICON_MAP[getEventIconName(eventType)] ?? Circle;
}

function getEventColor(eventType: string): string {
  if (eventType.includes("FAILED"))
    return "text-red-500 bg-red-500/10";
  if (
    eventType.includes("COMPLETED") ||
    eventType === "SESSION_COMPLETED" ||
    eventType === "MAPPING_ACCEPTED"
  )
    return "text-emerald-500 bg-emerald-500/10";
  if (eventType.includes("STARTED") || eventType === "FILL_EXECUTED")
    return "text-sky-500 bg-sky-500/10";
  if (
    eventType.includes("EDITED") ||
    eventType.includes("REVIEWED") ||
    eventType.includes("DELETED")
  )
    return "text-amber-500 bg-amber-500/10";
  return "text-muted-foreground bg-muted";
}

interface SessionTimelineProps {
  events: AuditEventSummary[];
}

export function SessionTimeline({ events }: SessionTimelineProps) {
  if (events.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No activity recorded yet.
      </p>
    );
  }

  return (
    <div className="relative space-y-0">
      {/* Vertical connector line */}
      <div className="absolute left-4 top-3 bottom-3 w-px bg-border" />

      {events.map((event) => {
        const Icon = getIconComponent(event.eventType);
        const colorClass = getEventColor(event.eventType);
        const summary = formatPayloadSummary(event.eventType, event.payload);

        return (
          <div key={event.id} className="relative flex items-start gap-4 py-3">
            <div
              className={`relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${colorClass}`}
            >
              <Icon className="h-4 w-4" />
            </div>

            <div className="min-w-0 flex-1 pt-0.5">
              <p className="text-sm font-medium text-foreground">
                {getEventLabel(event.eventType)}
              </p>
              {summary && (
                <p className="text-xs text-muted-foreground">{summary}</p>
              )}
              <p className="mt-0.5 text-xs text-muted-foreground/60">
                {formatDate(event.timestamp)}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
