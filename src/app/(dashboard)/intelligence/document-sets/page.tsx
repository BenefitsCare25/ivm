export const dynamic = "force-dynamic";

import Link from "next/link";
import { ArrowLeft, FolderCheck } from "lucide-react";
import { requireAuth } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { EmptyState } from "@/components/ui/empty-state";
import { DocumentSetList } from "@/components/intelligence/document-set-list";
import type { DocumentSetData } from "@/types/intelligence";

export default async function DocumentSetsPage() {
  const session = await requireAuth();

  const documentSets = await db.documentSet.findMany({
    where: { userId: session.user.id },
    orderBy: { name: "asc" },
    include: {
      items: {
        include: { documentType: { select: { id: true, name: true } } },
      },
    },
  });

  const serialized: DocumentSetData[] = documentSets.map((ds) => ({
    id: ds.id,
    name: ds.name,
    description: ds.description,
    isActive: ds.isActive,
    createdAt: ds.createdAt.toISOString(),
    updatedAt: ds.updatedAt.toISOString(),
    items: ds.items.map((item) => ({
      id: item.id,
      documentTypeId: item.documentTypeId,
      isRequired: item.isRequired,
      minCount: item.minCount,
      maxCount: item.maxCount,
      documentType: item.documentType,
    })),
  }));

  const availableDocTypes = await db.documentType.findMany({
    where: { userId: session.user.id, isActive: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

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
          <h1 className="text-2xl font-bold text-foreground">Document Sets</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Define collections of document types expected together for validation.
          </p>
        </div>
      </div>

      {serialized.length === 0 ? (
        <EmptyState
          icon={<FolderCheck className="h-10 w-10" />}
          title="No document sets yet"
          description="Create your first document set to define which documents are expected together."
        />
      ) : null}

      <DocumentSetList
        documentSets={serialized}
        availableDocTypes={availableDocTypes}
      />
    </div>
  );
}
