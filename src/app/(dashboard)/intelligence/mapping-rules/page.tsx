export const dynamic = "force-dynamic";

import Link from "next/link";
import { ArrowLeft, ArrowRightLeft } from "lucide-react";
import { requireAuth } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { EmptyState } from "@/components/ui/empty-state";
import { CodeMappingRuleList } from "@/components/intelligence/code-mapping-rule-list";
import type { CodeMappingRuleData } from "@/types/intelligence";

export default async function MappingRulesPage() {
  const session = await requireAuth();

  const [rules, datasets] = await Promise.all([
    db.codeMappingRule.findMany({
      where: { userId: session.user.id },
      orderBy: { name: "asc" },
      include: { dataset: { select: { id: true, name: true } } },
    }),
    db.referenceDataset.findMany({
      where: { userId: session.user.id, isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, columns: true },
    }),
  ]);

  const serializedRules: CodeMappingRuleData[] = rules.map((r) => ({
    id: r.id,
    name: r.name,
    sourceFieldLabel: r.sourceFieldLabel,
    datasetId: r.datasetId,
    lookupColumn: r.lookupColumn,
    outputColumn: r.outputColumn,
    matchStrategy: r.matchStrategy,
    isActive: r.isActive,
    dataset: r.dataset ?? undefined,
  }));

  const serializedDatasets = datasets.map((d) => ({
    id: d.id,
    name: d.name,
    columns: d.columns as string[],
  }));

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link
            href="/intelligence"
            className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Intelligence Hub
          </Link>
          <h1 className="text-2xl font-bold text-foreground">Mapping Rules</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Define rules to auto-map extracted field values to standard codes from reference datasets.
          </p>
        </div>
      </div>

      {serializedRules.length === 0 ? (
        <EmptyState
          icon={<ArrowRightLeft className="h-10 w-10" />}
          title="No mapping rules yet"
          description="Create mapping rules to automatically normalize extracted field values using your reference datasets."
        />
      ) : null}

      <CodeMappingRuleList rules={serializedRules} datasets={serializedDatasets} />
    </div>
  );
}
