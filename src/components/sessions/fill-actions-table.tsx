"use client";

import { RotateCcw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { FillActionSummary, FillActionStatus } from "@/types/fill";

interface FillActionsTableProps {
  actions: FillActionSummary[];
  onRetryField?: (targetFieldId: string) => void;
  retryingFieldId?: string | null;
}

const STATUS_VARIANT: Record<
  FillActionStatus,
  "success" | "warning" | "error" | "secondary" | "info"
> = {
  VERIFIED: "success",
  APPLIED: "info",
  PENDING: "secondary",
  FAILED: "error",
  SKIPPED: "warning",
};

const STATUS_LABEL: Record<FillActionStatus, string> = {
  VERIFIED: "Verified",
  APPLIED: "Applied",
  PENDING: "Pending",
  FAILED: "Failed",
  SKIPPED: "Skipped",
};

export function FillActionsTable({
  actions,
  onRetryField,
  retryingFieldId,
}: FillActionsTableProps) {
  if (actions.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No fill actions to display.
      </p>
    );
  }

  return (
    <Card className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/30">
            <th className="px-4 py-2 text-left font-medium text-muted-foreground">
              Target Field
            </th>
            <th className="px-4 py-2 text-left font-medium text-muted-foreground">
              Intended Value
            </th>
            <th className="px-4 py-2 text-left font-medium text-muted-foreground">
              Applied Value
            </th>
            <th className="px-4 py-2 text-left font-medium text-muted-foreground">
              Status
            </th>
          </tr>
        </thead>
        <tbody>
          {actions.map((action) => (
            <tr
              key={action.id}
              className="border-b border-border last:border-0"
            >
              <td className="px-4 py-2 font-medium text-foreground">
                {action.targetLabel}
              </td>
              <td className="px-4 py-2 text-muted-foreground">
                <span
                  className="inline-block max-w-[200px] truncate"
                  title={action.intendedValue}
                >
                  {action.intendedValue}
                </span>
              </td>
              <td className="px-4 py-2 text-muted-foreground">
                {action.status === "VERIFIED" ? (
                  <span
                    className="text-emerald-500"
                    title={action.verifiedValue ?? undefined}
                  >
                    {action.verifiedValue ?? "\u2014"}
                  </span>
                ) : action.appliedValue ? (
                  <span title={action.appliedValue}>{action.appliedValue}</span>
                ) : (
                  <span className="text-muted-foreground/50">{"\u2014"}</span>
                )}
              </td>
              <td className="px-4 py-2">
                <div className="flex items-center gap-2">
                  <Badge variant={STATUS_VARIANT[action.status]}>
                    {action.targetFieldId === retryingFieldId ? (
                      <span className="flex items-center gap-1">
                        <span className="h-3 w-3 animate-spin rounded-full border border-current border-t-transparent" />
                        Retrying
                      </span>
                    ) : (
                      STATUS_LABEL[action.status]
                    )}
                  </Badge>
                  {action.status === "FAILED" && onRetryField && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-xs"
                      disabled={!!retryingFieldId}
                      onClick={() => onRetryField(action.targetFieldId)}
                    >
                      <RotateCcw className="mr-1 h-3 w-3" />
                      Retry
                    </Button>
                  )}
                </div>
                {action.errorMessage && (
                  <p className="mt-1 text-xs text-red-500">
                    {action.errorMessage}
                  </p>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
