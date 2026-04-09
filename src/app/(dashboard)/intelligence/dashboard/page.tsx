export const dynamic = "force-dynamic";

import Link from "next/link";
import { ArrowLeft, FileType, FolderCheck, GitBranch, ScanSearch, CheckCircle2, XCircle, AlertTriangle } from "lucide-react";
import { requireAuth } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { formatDate } from "@/lib/utils";

export default async function IntelligenceDashboardPage() {
  const session = await requireAuth();
  const userId = session.user.id;
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [fillSessions, trackedItemsRaw] = await Promise.all([
    db.fillSession.findMany({ where: { userId }, select: { id: true } }),
    db.trackedItem.findMany({
      where: { scrapeSession: { portal: { userId } } },
      select: { id: true },
    }),
  ]);
  const fillSessionIds = fillSessions.map((s) => s.id);
  const trackedItemIds = trackedItemsRaw.map((i) => i.id);
  const validationWhere =
    fillSessionIds.length > 0 || trackedItemIds.length > 0
      ? {
          createdAt: { gte: sevenDaysAgo },
          OR: [
            ...(fillSessionIds.length > 0 ? [{ fillSessionId: { in: fillSessionIds } }] : []),
            ...(trackedItemIds.length > 0 ? [{ trackedItemId: { in: trackedItemIds } }] : []),
          ],
        }
      : { createdAt: { gte: sevenDaysAgo }, id: "no-match" };

  const [
    docTypesAll,
    docTypesActive,
    docSetsAll,
    docSetsActive,
    businessRulesAll,
    businessRulesActive,
    runsSum,
    extractionAll,
    extractionActive,
    validationGroups,
    recentValidations,
  ] = await Promise.all([
    db.documentType.count({ where: { userId } }),
    db.documentType.count({ where: { userId, isActive: true } }),
    db.documentSet.count({ where: { userId } }),
    db.documentSet.count({ where: { userId, isActive: true } }),
    db.businessRule.count({ where: { userId } }),
    db.businessRule.count({ where: { userId, isActive: true } }),
    db.businessRule.aggregate({ where: { userId }, _sum: { runCount: true } }),
    db.extractionTemplate.count({ where: { userId } }),
    db.extractionTemplate.count({ where: { userId, isActive: true } }),
    db.validationResult.groupBy({
      by: ["status"],
      where: validationWhere,
      _count: { _all: true },
    }),
    db.validationResult.findMany({
      where: validationWhere,
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { id: true, status: true, message: true, ruleType: true, createdAt: true },
    }),
  ]);

  const validationCounts = { pass: 0, fail: 0, warning: 0 };
  for (const v of validationGroups) {
    if (v.status === "PASS") validationCounts.pass = v._count._all;
    else if (v.status === "FAIL") validationCounts.fail = v._count._all;
    else if (v.status === "WARNING") validationCounts.warning = v._count._all;
  }

  const totalRuns = runsSum._sum.runCount ?? 0;
  const isAllEmpty = docTypesAll === 0 && docSetsAll === 0 && businessRulesAll === 0 && extractionAll === 0;
  const totalValidations = validationCounts.pass + validationCounts.fail + validationCounts.warning;

  const stats = [
    {
      title: "Document Types",
      icon: FileType,
      value: docTypesAll,
      sub: `${docTypesActive} active`,
      href: "/intelligence/document-types",
    },
    {
      title: "Document Sets",
      icon: FolderCheck,
      value: docSetsAll,
      sub: `${docSetsActive} active`,
      href: "/intelligence/document-sets",
    },
    {
      title: "Business Rules",
      icon: GitBranch,
      value: businessRulesAll,
      sub: `${businessRulesActive} active · ${totalRuns} runs`,
      href: "/intelligence/rules",
    },
    {
      title: "Extraction Templates",
      icon: ScanSearch,
      value: extractionAll,
      sub: `${extractionActive} active`,
      href: "/intelligence/extraction",
    },
    {
      title: "Validations (7d)",
      icon: CheckCircle2,
      value: totalValidations,
      sub: `${validationCounts.pass} pass · ${validationCounts.fail} fail · ${validationCounts.warning} warn`,
      href: null,
    },
    {
      title: "Rules Executed",
      icon: GitBranch,
      value: totalRuns,
      sub: "total across all rules",
      href: null,
    },
  ];

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
        <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Overview of your intelligence configuration and recent validation activity.
        </p>
      </div>

      <div className="rounded-lg border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
        <p className="font-medium text-foreground mb-1">Reading this dashboard</p>
        <ul className="list-disc pl-4 space-y-0.5">
          <li>Metric cards show total and active counts — inactive items do not run during processing.</li>
          <li><span className="font-medium text-foreground">Validations (7d)</span> counts all PASS / FAIL / WARNING results from both Auto Form and Portal Tracker in the last 7 days.</li>
          <li><span className="font-medium text-foreground">Rules Executed</span> is the cumulative total run count across all business rules since they were created.</li>
          <li>Click any metric card to navigate directly to that configuration section.</li>
        </ul>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {stats.map((s) => {
          const Icon = s.icon;
          const card = (
            <Card key={s.title} className={s.href ? "transition-colors hover:border-primary/40 hover:shadow-md cursor-pointer" : ""}>
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Icon className="h-4 w-4" />
                  <CardTitle className="text-sm font-medium">{s.title}</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold text-foreground">{s.value}</p>
                <p className="mt-1 text-xs text-muted-foreground">{s.sub}</p>
              </CardContent>
            </Card>
          );
          return s.href ? (
            <Link key={s.title} href={s.href}>{card}</Link>
          ) : (
            <div key={s.title}>{card}</div>
          );
        })}
      </div>

      {isAllEmpty && (
        <EmptyState
          icon={<CheckCircle2 className="h-10 w-10" />}
          title="Getting started"
          description="Create document types and sets, then configure business rules to automate validation during document processing."
        />
      )}

      <div>
        <h2 className="mb-3 text-base font-semibold text-foreground">Recent Validations (7d)</h2>
        {recentValidations.length === 0 ? (
          <p className="text-sm text-muted-foreground">No validations recorded in the last 7 days.</p>
        ) : (
          <div className="space-y-2">
            {recentValidations.map((v) => (
              <Card key={v.id}>
                <CardContent className="flex items-start justify-between gap-4 py-3">
                  <div className="flex items-start gap-3 min-w-0">
                    {v.status === "PASS" && <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />}
                    {v.status === "FAIL" && <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />}
                    {v.status === "WARNING" && <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />}
                    <div className="min-w-0">
                      <p className="truncate text-sm text-foreground">{v.message}</p>
                      <p className="text-xs text-muted-foreground">{v.ruleType}</p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
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
          </div>
        )}
      </div>
    </div>
  );
}
