export const dynamic = "force-dynamic";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireAuth } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { InfoGuide } from "@/components/intelligence/info-guide";
import { DocumentClassificationTabs } from "@/components/intelligence/document-classification-tabs";
import type { DocumentTypeData, DocumentSetData } from "@/types/intelligence";

export default async function DocumentClassificationPage() {
  const session = await requireAuth();

  const [documentTypes, documentSets] = await Promise.all([
    db.documentType.findMany({
      where: { userId: session.user.id },
      orderBy: { name: "asc" },
      include: { _count: { select: { documentSetItems: true } } },
    }),
    db.documentSet.findMany({
      where: { userId: session.user.id },
      orderBy: { name: "asc" },
      include: {
        items: {
          include: { documentType: { select: { id: true, name: true } } },
        },
      },
    }),
  ]);

  const availableDocTypes = documentTypes
    .filter((dt) => dt.isActive)
    .map((dt) => ({ id: dt.id, name: dt.name }));

  const serializedTypes: DocumentTypeData[] = documentTypes.map((dt) => ({
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

  const serializedSets: DocumentSetData[] = documentSets.map((ds) => ({
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
          <h1 className="text-2xl font-bold text-foreground">Document Classification</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Define document types and sets for automatic classification and validation.
          </p>
        </div>
      </div>

      <InfoGuide title="How Document Classification works">
        <p>
          <span className="font-medium text-foreground">Document Types</span> define the categories of documents your
          system processes — e.g. &quot;Medical Invoice&quot;, &quot;Claim Form&quot;, &quot;Discharge Summary&quot;. The
          AI compares each document&apos;s detected type against your defined types and aliases using fuzzy matching.
        </p>
        <p>
          <span className="font-medium text-foreground">Document Sets</span> define complete packages of document types
          expected together for a single case or claim. After files are classified, the system checks whether all
          required types in the set are present and generates MISSING_DOC validations for anything absent.
        </p>
        <div className="space-y-1">
          <p className="font-medium text-foreground">Where this runs:</p>
          <ul className="list-disc pl-4 space-y-0.5">
            <li>
              <span className="font-medium text-foreground">Portal Tracker</span> — when files are downloaded during
              a scrape session, each file is classified against your document types and required fields are validated.
              Document sets check that all expected documents are present per item.
            </li>
          </ul>
        </div>
        <div className="space-y-1">
          <p className="font-medium text-foreground">Tips:</p>
          <ul className="list-disc pl-4 space-y-0.5">
            <li>Add common aliases (e.g. &quot;med inv&quot;, &quot;hospital bill&quot;) so fuzzy matching catches real-world variations.</li>
            <li>Required Fields must be found in the extracted data — missing fields generate FAIL validations.</li>
            <li>Create Document Types first — Document Sets reference types by name.</li>
          </ul>
        </div>
      </InfoGuide>

      <DocumentClassificationTabs
        documentTypes={serializedTypes}
        documentSets={serializedSets}
        availableDocTypes={availableDocTypes}
      />
    </div>
  );
}
