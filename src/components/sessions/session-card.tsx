import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { DeleteSessionButton } from "./delete-session-button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/utils";
import {
  STEP_LABELS,
  type SessionStep,
  type SessionDetailSummary,
} from "@/types/session";

interface SessionCardProps {
  session: SessionDetailSummary;
}

const STATUS_BADGE_MAP: Record<
  string,
  {
    label: string;
    variant:
      | "default"
      | "secondary"
      | "success"
      | "warning"
      | "error"
      | "info";
  }
> = {
  CREATED: { label: "Created", variant: "secondary" },
  SOURCE_UPLOADED: { label: "Source Uploaded", variant: "info" },
  EXTRACTED: { label: "Extracted", variant: "info" },
  TARGET_SET: { label: "Target Set", variant: "info" },
  MAPPED: { label: "Mapped", variant: "warning" },
  FILLED: { label: "Filled", variant: "warning" },
  REVIEWED: { label: "Reviewed", variant: "success" },
  COMPLETED: { label: "Completed", variant: "success" },
  FAILED: { label: "Failed", variant: "error" },
};

export function SessionCard({ session }: SessionCardProps) {
  const statusInfo = STATUS_BADGE_MAP[session.status] ?? {
    label: session.status,
    variant: "secondary" as const,
  };

  return (
    <Card className="transition-shadow hover:shadow-md">
      <CardHeader className="flex flex-row items-start justify-between space-y-0">
        <div className="space-y-1">
          <CardTitle className="text-base">{session.title}</CardTitle>
          {session.description && (
            <CardDescription className="line-clamp-2">
              {session.description}
            </CardDescription>
          )}
        </div>
        <Badge variant={statusInfo.variant}>{statusInfo.label}</Badge>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span>{STEP_LABELS[session.currentStep as SessionStep]}</span>
          {session.sourceFileName && (
            <span
              className="max-w-[120px] truncate"
              title={session.sourceFileName}
            >
              {session.sourceFileName}
            </span>
          )}
          {session.targetType && <span>{session.targetType}</span>}
          {session.extractedFieldCount > 0 && (
            <span>{session.extractedFieldCount} fields</span>
          )}
          <span suppressHydrationWarning>Updated {formatDate(session.updatedAt)}</span>
        </div>
      </CardContent>
      <CardFooter className="justify-between">
        <DeleteSessionButton sessionId={session.id} />
        <Button variant="ghost" size="sm" asChild>
          <Link href={`/sessions/${session.id}`}>
            Continue
            <ArrowRight className="ml-2 h-3.5 w-3.5" />
          </Link>
        </Button>
      </CardFooter>
    </Card>
  );
}
