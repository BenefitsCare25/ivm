export const dynamic = "force-dynamic";

import Link from "next/link";
import { ArrowLeft, History, CheckCircle2, XCircle, AlertTriangle, Info } from "lucide-react";
import { requireAuth } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { formatDate } from "@/lib/utils";

export default async function IntelligenceAuditPage() {
  const session = await requireAuth();
  const userId = session.user.id;

  const [fillSessions, trackedItemsRaw] = await Promise.all([
    db.fillSession.findMany({ where: { userId }, select: { id: true } }),
    db.trackedItem.findMany({
      where: { scrapeSession: { portal: { userId } } },
      select: { id: true },
    }),
  ]);

  const fillSessionIds = fillSessions.map((s) => s.id);
  const trackedItemIds = trackedItemsRaw.map((i) => i.id);
  const hasScope = fillSessionIds.length > 0 || trackedItemIds.length > 0;

  const validations = hasScope
    ? await db.validationResult.findMany({
        where: {
          OR: [
            ...(fillSessionIds.length > 0 ? [{ fillSessionId: { in: fillSessionIds } }] : []),
            ...(trackedItemIds.length > 0 ? [{ trackedItemId: { in: trackedItemIds } }] : []),
          ],
        },
        orderBy: { createdAt: "desc" },
        take: 100,
      })
    : [];

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/intelligence"
          className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Intelligence Hub
        </Link>
        <h1 className="text-2xl font-bold text-foreground">Validation History</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Results from document validation rules run during Auto Form and Portal Tracker processing.
        </p>
      </div>

      <div className="rounded-lg border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
        <div className="flex items-center gap-2 mb-2">
          <Info className="h-4 w-4 shrink-0 text-blue-500" />
          <p className="font-medium text-foreground">Reading validation results</p>
        </div>
        <div className="space-y-1.5">
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            <span className="flex items-center gap-1.5"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /><span>PASS — check completed successfully</span></span>
            <span className="flex items-center gap-1.5"><XCircle className="h-3.5 w-3.5 text-red-500" /><span>FAIL — a required check failed</span></span>
            <span className="flex items-center gap-1.5"><AlertTriangle className="h-3.5 w-3.5 text-amber-500" /><span>WARNING — flagged for review</span></span>
          </div>
          <p className="font-medium text-foreground mt-1">Rule types:</p>
          <ul className="list-disc pl-4 space-y-0.5 font-mono text-xs">
            <li><span className="text-foreground">DOC_TYPE_MATCH</span> — document classification result</li>
            <li><span className="text-foreground">MISSING_DOC</span> — required document absent from a document set (Portal Tracker)</li>
            <li><span className="text-foreground">DUPLICATE</span> — document matches a previously processed document (within 90 days)</li>
            <li><span className="text-foreground">REQUIRED_FIELD</span> — a required field from the document type was not extracted</li>
            <li><span className="text-foreground">BUSINESS_RULE</span> — a custom business rule condition was triggered</li>
          </ul>
          <p className="font-mono text-xs mt-1">
            Validations come from <span className="font-medium not-italic text-foreground">Auto Form</span> (review step Validations panel)
            and <span className="font-medium not-italic text-foreground">Portal Tracker</span> (item detail expanded row). Use this log to
            debug rules that are not triggering as expected.
          </p>
        </div>
      </div>

      {validations.length === 0 ? (
        <EmptyState
          icon={<History className="h-10 w-10" />}
          title="No validations yet"
          description="Process documents in Auto Form or Portal Tracker to see validation results here."
        />
      ) : (
        <div className="space-y-2">
          {validations.map((v) => (
            <Card key={v.id}>
              <CardContent className="flex items-start justify-between gap-4 py-3">
                <div className="flex items-start gap-3 min-w-0">
                  {v.status === "PASS" && <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />}
                  {v.status === "FAIL" && <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />}
                  {v.status === "WARNING" && <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />}
                  <div className="min-w-0">
                    <p className="text-sm text-foreground">{v.message}</p>
                    <p className="mt-0.5 font-mono text-xs text-muted-foreground">{v.ruleType}</p>
                  </div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <Badge
                    variant={v.status === "PASS" ? "success" : v.status === "FAIL" ? "error" : "warning"}
                    className="text-xs"
                  >
                    {v.status}
                  </Badge>
                  <span className="whitespace-nowrap text-xs text-muted-foreground">
                    {formatDate(v.createdAt)}
                  </span>
                </div>
              </CardContent>
            </Card>
          ))}
          {validations.length === 100 && (
            <p className="text-xs text-muted-foreground">Showing latest 100 results.</p>
          )}
        </div>
      )}
    </div>
  );
}
