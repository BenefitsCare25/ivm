export const dynamic = "force-dynamic";

import Link from "next/link";
import { ArrowLeft, FileType } from "lucide-react";
import { requireAuth } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { DocumentTypeList } from "@/components/intelligence/document-type-list";
import { InfoGuide } from "@/components/intelligence/info-guide";
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

      <InfoGuide title="How Document Types work">
        <p>
          Document Types define the categories of documents your system processes — e.g. &quot;Medical Invoice&quot;,
          &quot;Claim Form&quot;, &quot;Discharge Summary&quot;. The AI compares each uploaded document&apos;s detected
          type against your defined types and aliases using fuzzy matching to classify it automatically.
        </p>
        <div className="space-y-1">
          <p className="font-medium text-foreground">Where this runs:</p>
          <ul className="list-disc pl-4 space-y-0.5">
            <li>
              <span className="font-medium text-foreground">Auto Form</span> — when a document is uploaded, the AI
              classifies it against your document types, then checks that all required fields are present. Results
              appear in the Validations panel on the review step.
            </li>
            <li>
              <span className="font-medium text-foreground">Portal Tracker</span> — when files are downloaded during
              a scrape session, each file is classified and required fields are validated. Results show in the item
              detail expanded row.
            </li>
          </ul>
        </div>
        <div className="space-y-1">
          <p className="font-medium text-foreground">Tips:</p>
          <ul className="list-disc pl-4 space-y-0.5">
            <li>Add common aliases (e.g. &quot;med inv&quot;, &quot;hospital bill&quot;) so fuzzy matching catches real-world variations.</li>
            <li>Required Fields must be found in the extracted data — missing fields generate FAIL validations.</li>
            <li>
              <span className="font-medium text-foreground">Start here first</span> — Document Types must exist
              before Document Sets, Extraction Templates, or Business Rule scopes can reference them.
            </li>
          </ul>
        </div>
      </InfoGuide>

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
