export const dynamic = "force-dynamic";

import Link from "next/link";
import { ArrowLeft, ArrowRightLeft } from "lucide-react";
import { requireAuth } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { EmptyState } from "@/components/ui/empty-state";
import { CodeMappingRuleList } from "@/components/intelligence/code-mapping-rule-list";
import { InfoGuide } from "@/components/intelligence/info-guide";
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

      <InfoGuide title="How Mapping Rules work">
        <p>
          Mapping Rules automatically translate raw extracted field values into standardized codes using your
          Reference Datasets. They run after AI extraction, before the review step — so the normalized value
          is what you see in the output.
        </p>
        <div className="space-y-1">
          <p className="font-medium text-foreground">Where this runs:</p>
          <ul className="list-disc pl-4 space-y-0.5">
            <li>
              <span className="font-medium text-foreground">Auto Form</span> — after AI extracts fields, any field
              whose label matches the Source Field Label is looked up in the dataset and the output column value
              is appended to the extracted data.
            </li>
            <li>
              <span className="font-medium text-foreground">Portal Tracker</span> — same pipeline applies to files
              downloaded during a scrape session.
            </li>
          </ul>
        </div>
        <div className="space-y-1">
          <p className="font-medium text-foreground">Match strategies:</p>
          <ul className="list-disc pl-4 space-y-0.5">
            <li><span className="font-medium text-foreground">Exact</span> — value must match the lookup column character-for-character.</li>
            <li><span className="font-medium text-foreground">Fuzzy</span> — tolerates minor spelling differences and extra whitespace.</li>
            <li><span className="font-medium text-foreground">Contains</span> — matches if the lookup column value appears anywhere in the extracted value.</li>
            <li><span className="font-medium text-foreground">AI</span> — uses LLM semantic matching for complex or ambiguous values (slower, most flexible).</li>
          </ul>
        </div>
        <p>
          <span className="font-medium text-foreground">Prerequisite:</span> Create a Reference Dataset and import
          CSV data first — you cannot select lookup/output columns without a dataset.
        </p>
      </InfoGuide>

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
