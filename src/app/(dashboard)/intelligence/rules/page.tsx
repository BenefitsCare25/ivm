export const dynamic = "force-dynamic";

import Link from "next/link";
import { ArrowLeft, GitBranch } from "lucide-react";
import { requireAuth } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { EmptyState } from "@/components/ui/empty-state";
import { BusinessRuleList } from "@/components/intelligence/business-rule-list";
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
