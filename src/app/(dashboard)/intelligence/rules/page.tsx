export const dynamic = "force-dynamic";

import Link from "next/link";
import { ArrowLeft, GitBranch } from "lucide-react";
import { requireAuth } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { EmptyState } from "@/components/ui/empty-state";
import { BusinessRuleList } from "@/components/intelligence/business-rule-list";
import { InfoGuide } from "@/components/intelligence/info-guide";
import type { BusinessRuleData } from "@/types/intelligence";

export default async function BusinessRulesPage() {
  const session = await requireAuth();

  const [rules, documentTypes] = await Promise.all([
    db.businessRule.findMany({
      where: { userId: session.user.id },
      orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
    }),
    db.documentType.findMany({
      where: { userId: session.user.id, isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  const serialized: BusinessRuleData[] = rules.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    priority: r.priority,
    isActive: r.isActive,
    triggerPoint: r.triggerPoint as BusinessRuleData["triggerPoint"],
    conditions: r.conditions as unknown as BusinessRuleData["conditions"],
    actions: r.actions as unknown as BusinessRuleData["actions"],
    scope: (r.scope as BusinessRuleData["scope"]) ?? {},
    runCount: r.runCount,
    lastRunAt: r.lastRunAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  }));

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
        <h1 className="text-2xl font-bold text-foreground">Business Rules</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Define if/then processing rules that run automatically during extraction, mapping, or comparison.
        </p>
      </div>

      <InfoGuide title="How Business Rules work">
        <p>
          Business Rules are if/then conditions that run automatically at defined trigger points during document
          processing. Use them to auto-flag anomalies, override statuses, add review notes, or escalate items
          based on extracted field values.
        </p>
        <div className="space-y-1">
          <p className="font-medium text-foreground">Trigger points:</p>
          <ul className="list-disc pl-4 space-y-0.5">
            <li>
              <span className="font-medium text-foreground">POST_EXTRACTION</span> — runs right after AI extracts
              fields from downloaded files during a Portal Tracker scrape.
            </li>
            <li>
              <span className="font-medium text-foreground">POST_MAPPING</span> — runs after Mapping Rules are
              applied to the extracted fields.
            </li>
            <li>
              <span className="font-medium text-foreground">POST_COMPARISON</span> — runs after Portal Tracker
              compares portal data vs downloaded PDF data.
            </li>
          </ul>
        </div>
        <div className="space-y-1">
          <p className="font-medium text-foreground">Action params reference:</p>
          <ul className="list-disc pl-4 space-y-0.5 font-mono text-xs">
            <li><span className="text-foreground">FLAG</span> {`{"reason": "Amount exceeds threshold"}`}</li>
            <li><span className="text-foreground">SET_STATUS</span> {`{"status": "REVIEW"}`}</li>
            <li><span className="text-foreground">ADD_NOTE</span> {`{"note": "Requires manual verification"}`}</li>
            <li><span className="text-foreground">SET_FIELD</span> {`{"field": "fieldName", "value": "newValue"}`}</li>
            <li><span className="text-foreground">ESCALATE</span> {`{"to": "supervisor", "reason": "High value claim"}`}</li>
            <li><span className="text-foreground">SKIP</span> {`{}`} — stops further rule processing for this item.</li>
          </ul>
        </div>
        <p className="text-xs">
          Higher priority numbers run first. Rules with the same trigger point execute in priority order.
          Results appear in the Validation History (Audit Log) and the item&apos;s Validations panel.
        </p>
      </InfoGuide>

      {serialized.length === 0 && (
        <EmptyState
          icon={<GitBranch className="h-10 w-10" />}
          title="No business rules yet"
          description="Create rules to auto-flag documents, set statuses, or trigger escalations based on field values."
        />
      )}

      <BusinessRuleList rules={serialized} documentTypes={documentTypes} />
    </div>
  );
}
