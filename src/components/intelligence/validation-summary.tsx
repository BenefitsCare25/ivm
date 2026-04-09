"use client";

import { useState, useEffect } from "react";
import { CheckCircle2, XCircle, AlertTriangle, Loader2, ShieldCheck } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { ValidationResultData } from "@/types/intelligence";

interface ValidationSummaryProps {
  fillSessionId?: string;
  portalId?: string;
  sessionId?: string;
  itemId?: string;
  compact?: boolean;
}

const STATUS_CONFIG = {
  PASS: { icon: CheckCircle2, color: "text-emerald-500", bg: "bg-emerald-500/10", label: "Pass" },
  FAIL: { icon: XCircle, color: "text-red-500", bg: "bg-red-500/10", label: "Fail" },
  WARNING: { icon: AlertTriangle, color: "text-amber-500", bg: "bg-amber-500/10", label: "Warning" },
} as const;

const RULE_TYPE_LABELS: Record<string, string> = {
  DOC_TYPE_MATCH: "Classification",
  MISSING_DOC: "Document Set",
  DUPLICATE: "Duplicate Check",
  REQUIRED_FIELD: "Required Fields",
  BUSINESS_RULE: "Business Rule",
};

export function ValidationSummary({
  fillSessionId,
  portalId,
  sessionId,
  itemId,
  compact = false,
}: ValidationSummaryProps) {
  const [results, setResults] = useState<ValidationResultData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchResults() {
      try {
        let url: string;
        if (fillSessionId) {
          url = `/api/sessions/${fillSessionId}/validations`;
        } else if (portalId && sessionId && itemId) {
          url = `/api/portals/${portalId}/scrape/${sessionId}/items/${itemId}/validations`;
        } else {
          setLoading(false);
          return;
        }

        const res = await fetch(url);
        if (res.ok) {
          const data = await res.json();
          setResults(data);
        }
      } catch {
        // Silently fail — validation is supplementary
      } finally {
        setLoading(false);
      }
    }

    fetchResults();
  }, [fillSessionId, portalId, sessionId, itemId]);

  if (loading) {
    return compact ? null : (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Loading validations...
      </div>
    );
  }

  if (results.length === 0) return null;

  const counts = {
    PASS: results.filter((r) => r.status === "PASS").length,
    FAIL: results.filter((r) => r.status === "FAIL").length,
    WARNING: results.filter((r) => r.status === "WARNING").length,
  };

  if (compact) {
    return <ValidationBadges counts={counts} />;
  }

  return (
    <Card>
      <CardContent className="pt-5">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold text-foreground">Validation</h3>
          </div>
          <ValidationBadges counts={counts} />
        </div>

        <div className="space-y-1.5">
          {results
            .filter((r) => r.status !== "PASS")
            .map((r) => {
              const cfg = STATUS_CONFIG[r.status as keyof typeof STATUS_CONFIG] ?? STATUS_CONFIG.WARNING;
              const Icon = cfg.icon;
              return (
                <div key={r.id} className="flex items-start gap-2 text-sm">
                  <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${cfg.color}`} />
                  <div className="min-w-0 flex-1">
                    <span className="text-foreground">{r.message}</span>
                    <Badge variant="secondary" className="ml-2 text-[10px]">
                      {RULE_TYPE_LABELS[r.ruleType] ?? r.ruleType}
                    </Badge>
                  </div>
                </div>
              );
            })}

          {counts.FAIL === 0 && counts.WARNING === 0 && (
            <div className="flex items-center gap-2 text-sm text-emerald-600">
              <CheckCircle2 className="h-4 w-4" />
              All validations passed
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function ValidationBadges({ counts }: { counts: { PASS: number; FAIL: number; WARNING: number } }) {
  return (
    <div className="flex items-center gap-1.5">
      {counts.PASS > 0 && (
        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-600">
          <CheckCircle2 className="h-3 w-3" />
          {counts.PASS}
        </span>
      )}
      {counts.FAIL > 0 && (
        <span className="inline-flex items-center gap-1 rounded-full bg-red-500/10 px-2 py-0.5 text-xs text-red-600">
          <XCircle className="h-3 w-3" />
          {counts.FAIL}
        </span>
      )}
      {counts.WARNING > 0 && (
        <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-xs text-amber-600">
          <AlertTriangle className="h-3 w-3" />
          {counts.WARNING}
        </span>
      )}
    </div>
  );
}
