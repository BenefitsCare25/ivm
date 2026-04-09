export const dynamic = "force-dynamic";

import Link from "next/link";
import { ArrowLeft, ScanSearch } from "lucide-react";
import { requireAuth } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { ExtractionConfig } from "@/components/intelligence/extraction-config";
import type { ExtractionTemplateData } from "@/types/intelligence";

export default async function ExtractionPage() {
  const session = await requireAuth();

  const [templates, normRules, escalationConfig, documentTypes] = await Promise.all([
    db.extractionTemplate.findMany({
      where: { userId: session.user.id },
      orderBy: { name: "asc" },
      include: { documentType: { select: { id: true, name: true } } },
    }),
    db.normalizationRule.findMany({
      where: { userId: session.user.id },
      orderBy: { name: "asc" },
    }),
    db.escalationConfig.findUnique({
      where: { userId: session.user.id },
    }),
    db.documentType.findMany({
      where: { userId: session.user.id, isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  const serializedTemplates: ExtractionTemplateData[] = templates.map((t) => ({
    id: t.id,
    name: t.name,
    documentTypeId: t.documentTypeId,
    expectedFields: t.expectedFields as unknown as ExtractionTemplateData["expectedFields"],
    instructions: t.instructions,
    isActive: t.isActive,
    documentType: t.documentType,
  }));

  const serializedNormRules = normRules.map((r) => ({
    id: r.id,
    name: r.name,
    fieldType: r.fieldType,
    pattern: r.pattern,
    outputFormat: r.outputFormat,
    isActive: r.isActive,
    createdAt: r.createdAt.toISOString(),
  }));

  const serializedEscalation = escalationConfig
    ? {
        confidenceThreshold: escalationConfig.confidenceThreshold,
        autoFlagLowConfidence: escalationConfig.autoFlagLowConfidence,
        escalationMessage: escalationConfig.escalationMessage,
      }
    : null;

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
        <h1 className="text-2xl font-bold text-foreground">Extraction Config</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Configure extraction templates, normalization rules, and escalation settings for AI-powered document processing.
        </p>
      </div>

      <ExtractionConfig
        templates={serializedTemplates}
        documentTypes={documentTypes}
        normRules={serializedNormRules}
        escalationConfig={serializedEscalation}
      />
    </div>
  );
}
