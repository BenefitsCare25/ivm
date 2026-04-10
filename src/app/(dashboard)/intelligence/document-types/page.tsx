export const dynamic = "force-dynamic";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireAuth } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { InfoGuide } from "@/components/intelligence/info-guide";
import { DocumentTypeList } from "@/components/intelligence/document-type-list";
import type { DocumentTypeData } from "@/types/intelligence";

export default async function DocumentClassificationPage() {
  const session = await requireAuth();

  const documentTypes = await db.documentType.findMany({
    where: { userId: session.user.id },
    orderBy: { name: "asc" },
  });

  const serializedTypes: DocumentTypeData[] = documentTypes.map((dt) => ({
    id: dt.id,
    name: dt.name,
    aliases: dt.aliases as string[],
    category: dt.category,
    requiredFields: dt.requiredFields as string[],
    isActive: dt.isActive,
    createdAt: dt.createdAt.toISOString(),
    updatedAt: dt.updatedAt.toISOString(),
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
            Define the types of documents your portals download for automatic classification and field validation.
          </p>
        </div>
      </div>

      <InfoGuide title="How Document Types work">
        <p>
          When Portal Tracker downloads files during a scrape session, the AI identifies what kind of document each file
          is (e.g. &quot;invoice&quot;, &quot;discharge summary&quot;). It compares that against your defined types
          using fuzzy matching on the name and aliases.
        </p>
        <div className="space-y-1">
          <p className="font-medium text-foreground">What each field does:</p>
          <ul className="list-disc pl-4 space-y-0.5">
            <li><span className="font-medium text-foreground">Aliases</span> — alternative names the AI may use (e.g. &quot;med inv&quot;, &quot;hospital bill&quot; for a Medical Invoice). More aliases = better matching.</li>
            <li><span className="font-medium text-foreground">Required in extracted data</span> — field names that must appear in the AI-extracted content. Missing fields generate FAIL validations on the item.</li>
            <li><span className="font-medium text-foreground">Category</span> — optional grouping for your own reference (Financial, Medical, Legal, etc.).</li>
          </ul>
        </div>
      </InfoGuide>

      <DocumentTypeList documentTypes={serializedTypes} />
    </div>
  );
}
