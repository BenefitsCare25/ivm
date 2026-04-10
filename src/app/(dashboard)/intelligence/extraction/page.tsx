export const dynamic = "force-dynamic";

import Link from "next/link";
import { ArrowLeft, ScanSearch } from "lucide-react";
import { requireAuth } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { ExtractionConfig } from "@/components/intelligence/extraction-config";
import { InfoGuide } from "@/components/intelligence/info-guide";
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

      <InfoGuide title="How Extraction Config works">
        <p>
          Extraction Config has three independent settings that all affect how AI reads and processes documents.
          Changes take effect on the next document processed — they do not reprocess existing sessions.
        </p>
        <div className="space-y-1">
          <p className="font-medium text-foreground">Templates tab — guide the AI on what to extract:</p>
          <ul className="list-disc pl-4 space-y-0.5">
            <li>Without a template, the AI extracts whatever fields it finds in the document.</li>
            <li>With a template, the AI uses your expected field list as a structured guide, improving accuracy and consistency.</li>
            <li>Link a template to a <span className="font-medium text-foreground">Document Type</span> so it only activates for that specific doc type after classification.</li>
            <li>The <span className="font-medium text-foreground">Instructions</span> field adds custom guidance to the AI prompt — e.g. &quot;Focus on line items only, ignore page headers.&quot;</li>
          </ul>
        </div>
        <div className="space-y-1">
          <p className="font-medium text-foreground">Normalization tab — reformat values after extraction:</p>
          <ul className="list-disc pl-4 space-y-0.5">
            <li>Use a regex <span className="font-medium text-foreground">Pattern</span> to match raw values, and an <span className="font-medium text-foreground">Output Format</span> to rewrite them.</li>
            <li>Applied to all fields of the matching field type (text, date, number, etc.).</li>
            <li>Example: Pattern <code className="rounded bg-muted px-1 text-xs">{"(\\d{4})-(\\d{2})-(\\d{2})"}</code> → Output <code className="rounded bg-muted px-1 text-xs">DD/MM/YYYY</code> standardizes date formatting.</li>
          </ul>
        </div>
        <div className="space-y-1">
          <p className="font-medium text-foreground">Escalation tab — auto-flag low-confidence extractions:</p>
          <ul className="list-disc pl-4 space-y-0.5">
            <li>AI returns a confidence score (0.0–1.0) per field. Fields below your threshold are flagged.</li>
            <li>Enable <span className="font-medium text-foreground">Auto-flag low confidence</span> to create a WARNING validation automatically.</li>
            <li>The escalation message is shown in the Validations panel so reviewers know why the document was flagged.</li>
          </ul>
        </div>
        <p className="text-xs">
          All three settings apply to <span className="font-medium text-foreground">Portal Tracker</span> file
          extraction during scrape sessions.
        </p>
      </InfoGuide>

      <ExtractionConfig
        templates={serializedTemplates}
        documentTypes={documentTypes}
        normRules={serializedNormRules}
        escalationConfig={serializedEscalation}
      />
    </div>
  );
}
