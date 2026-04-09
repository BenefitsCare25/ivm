export const dynamic = "force-dynamic";

import Link from "next/link";
import { ArrowLeft, History, CheckCircle2, XCircle, AlertTriangle } from "lucide-react";
import { requireAuth } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { formatDate } from "@/lib/utils";

export default async function IntelligenceAuditPage() {
  const session = await requireAuth();
  const userId = session.user.id;

  // Scope validation results to this user via fill sessions and tracked items
  const [fillSessions, portals] = await Promise.all([
    db.fillSession.findMany({ where: { userId }, select: { id: true } }),
    db.portal.findMany({ where: { userId }, select: { id: true } }),
  ]);

  const fillSessionIds = fillSessions.map((s) => s.id);

  let trackedItemIds: string[] = [];
  if (portals.length > 0) {
    const scrapeSessions = await db.scrapeSession.findMany({
      where: { portalId: { in: portals.map((p) => p.id) } },
      select: { id: true },
    });
    if (scrapeSessions.length > 0) {
      const items = await db.trackedItem.findMany({
        where: { scrapeSessionId: { in: scrapeSessions.map((s) => s.id) } },
        select: { id: true },
      });
      trackedItemIds = items.map((i) => i.id);
    }
  }

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
