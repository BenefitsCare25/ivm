export const dynamic = "force-dynamic";

import Link from "next/link";
import { ArrowLeft, Database } from "lucide-react";
import { requireAuth } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { EmptyState } from "@/components/ui/empty-state";
import { ReferenceDatasetList } from "@/components/intelligence/reference-dataset-list";
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
