export const dynamic = "force-dynamic";

import Link from "next/link";
import { ArrowLeft, Database } from "lucide-react";
import { requireAuth } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { EmptyState } from "@/components/ui/empty-state";
import { ReferenceDatasetList } from "@/components/intelligence/reference-dataset-list";
import { InfoGuide } from "@/components/intelligence/info-guide";
import type { ReferenceDatasetData } from "@/types/intelligence";

export default async function DatasetsPage() {
  const session = await requireAuth();

  const datasets = await db.referenceDataset.findMany({
    where: { userId: session.user.id },
    orderBy: { name: "asc" },
    include: { _count: { select: { entries: true } } },
  });

  const serialized: ReferenceDatasetData[] = datasets.map((ds) => ({
    id: ds.id,
    name: ds.name,
    description: ds.description,
    columns: ds.columns as string[],
    rowCount: ds.rowCount,
    sourceType: ds.sourceType,
    version: ds.version,
    isActive: ds.isActive,
    createdAt: ds.createdAt.toISOString(),
    updatedAt: ds.updatedAt.toISOString(),
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
          <h1 className="text-2xl font-bold text-foreground">Reference Data</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Upload lookup tables and code mapping datasets for automatic field normalization.
          </p>
        </div>
      </div>

      <InfoGuide title="How Reference Data works">
        <p>
          Reference datasets are lookup tables — like a spreadsheet — used by Mapping Rules to translate raw
          extracted values into standardized codes. For example, a dataset of ICD-10 codes lets a Mapping Rule
          convert &quot;low back pain&quot; to &quot;M54.5&quot; automatically.
        </p>
        <div className="space-y-1">
          <p className="font-medium text-foreground">Setup steps:</p>
          <ol className="list-decimal pl-4 space-y-0.5">
            <li>Create a dataset and give it a name (e.g. &quot;ICD-10 Codes&quot; or &quot;Payer Codes&quot;).</li>
            <li>Click <span className="font-medium text-foreground">Manage Data</span> on the dataset card.</li>
            <li>Paste CSV data — first row must be column headers, remaining rows are data.</li>
            <li>Go to <span className="font-medium text-foreground">Mapping Rules</span> to define which field to look up and which column to return.</li>
          </ol>
        </div>
        <div className="space-y-1">
          <p className="font-medium text-foreground">CSV format:</p>
          <pre className="rounded bg-muted px-3 py-2 font-mono text-xs text-foreground">
{`code,description,category
M54.5,Low back pain,Musculoskeletal
J06.9,Upper respiratory infection,Respiratory`}
          </pre>
        </div>
        <p>
          <span className="font-medium text-foreground">Note:</span> Datasets have no direct pipeline step on their
          own. They only activate when a Mapping Rule references them.
        </p>
      </InfoGuide>

      {serialized.length === 0 ? (
        <EmptyState
          icon={<Database className="h-10 w-10" />}
          title="No datasets yet"
          description="Create a dataset and import CSV data to enable code mapping lookups."
        />
      ) : null}

      <ReferenceDatasetList datasets={serialized} />
    </div>
  );
}
