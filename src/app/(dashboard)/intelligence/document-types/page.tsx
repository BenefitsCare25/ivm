export const dynamic = "force-dynamic";

import Link from "next/link";
import { ArrowLeft, FileType } from "lucide-react";
import { requireAuth } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { DocumentTypeList } from "@/components/intelligence/document-type-list";
import type { DocumentTypeData } from "@/types/intelligence";

export default async function DocumentTypesPage() {
  const session = await requireAuth();

  const documentTypes = await db.documentType.findMany({
    where: { userId: session.user.id },
    orderBy: { name: "asc" },
    include: { _count: { select: { documentSetItems: true } } },
  });

  const serialized: DocumentTypeData[] = documentTypes.map((dt) => ({
    id: dt.id,
    name: dt.name,
    aliases: dt.aliases as string[],
    category: dt.category,
    requiredFields: dt.requiredFields as string[],
    isActive: dt.isActive,
    createdAt: dt.createdAt.toISOString(),
    updatedAt: dt.updatedAt.toISOString(),
    _count: dt._count,
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
          <h1 className="text-2xl font-bold text-foreground">Document Types</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Define document types with aliases and required fields for automatic classification.
          </p>
        </div>
      </div>

      {serialized.length === 0 ? (
        <EmptyState
          icon={<FileType className="h-10 w-10" />}
          title="No document types yet"
          description="Create your first document type to start classifying documents automatically."
        />
      ) : null}

      <DocumentTypeList documentTypes={serialized} />
    </div>
  );
}
