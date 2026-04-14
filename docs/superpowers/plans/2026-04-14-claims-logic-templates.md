# Claims Logic Templates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand ComparisonTemplate with explicit field aliases, required documents, and AI-evaluated business rules — all configurable per claim type via a new template detail page, with a live AI prompt preview.

**Architecture:** Extend the existing `ComparisonTemplate` JSON columns (no new Prisma models). Build a combined AI prompt that handles field comparison + business rule evaluation + required document checking in one call. Store results in existing `ValidationResult` model with new `ruleType` values. New template detail page with 4 cards replaces inline editing.

**Tech Stack:** Next.js 15 App Router, Prisma 6, Tailwind CSS v4, Radix UI, Anthropic/OpenAI/Gemini AI APIs

---

## File Structure

### New Files
| File | Responsibility |
|------|---------------|
| `prisma/migrations/2026MMDD_claims_logic_templates/migration.sql` | Add `requiredDocuments`, `businessRules` columns + migrate `fields` JSON |
| `src/app/(dashboard)/portals/[id]/templates/[templateId]/page.tsx` | Template detail page (server component) |
| `src/components/portals/template-detail-view.tsx` | Main client component — orchestrates 4 cards |
| `src/components/portals/template-field-mappings.tsx` | Card 1: field mapping table with portal↔document pairs |
| `src/components/portals/template-required-documents.tsx` | Card 2: required documents configuration |
| `src/components/portals/template-business-rules.tsx` | Card 3: categorized business rules with severity |
| `src/components/portals/template-prompt-preview.tsx` | Card 4: live AI prompt preview |
| `src/lib/ai/prompt-builder.ts` | `buildFullComparisonPrompt()` and `buildPromptPreview()` utilities |

### Modified Files
| File | Changes |
|------|---------|
| `src/types/portal.ts` | Update `TemplateField`, add `RequiredDocument`, `BusinessRule`, `BusinessRuleResult`, `RequiredDocumentCheck` types; update `FWA_RULE_TYPES`/`FWA_LABELS`; update `ComparisonTemplateSummary` |
| `src/lib/validations/portal.ts` | Update `templateFieldSchema`, add `requiredDocumentSchema`, `businessRuleSchema`; update `createComparisonTemplateSchema`, `updateComparisonTemplateSchema` |
| `src/lib/ai/prompts-comparison.ts` | Update `getTemplatedComparisonUserPrompt()` to use `portalFieldName`/`documentFieldName` |
| `src/lib/ai/comparison.ts` | Expand `ComparisonResponse` and `parseComparisonResponse()` for business rules + required docs |
| `src/lib/comparison-templates.ts` | Update `filterFieldsByTemplate()` to use `portalFieldName`; update `CachedPortalTemplates` to include new fields |
| `src/workers/item-detail-worker.ts` | Use combined prompt when template has rules; save `ValidationResult` records |
| `src/app/api/portals/[id]/templates/[templateId]/route.ts` | Update PATCH to accept `requiredDocuments`, `businessRules` |
| `src/app/api/portals/[id]/templates/route.ts` | Update POST to accept new fields; return `id` for redirect |
| `src/app/api/portals/[id]/scrape/[sessionId]/recompare/route.ts` | Clear + recreate `BUSINESS_RULE`/`REQUIRED_DOCUMENT` validation results |
| `src/components/portals/template-list.tsx` | Make rows link to detail page; show rule count; use `portalFieldName` |
| `src/components/portals/tracked-items-table.tsx` | Handle multiple FWA alerts per item (business rules can produce several) |
| `prisma/schema.prisma` | Add `requiredDocuments`, `businessRules` columns to `ComparisonTemplate` |

---

## Task 1: Types & Validation Schemas

**Files:**
- Modify: `src/types/portal.ts:145-170`
- Modify: `src/lib/validations/portal.ts:105-124`

- [ ] **Step 1: Update `TemplateField` interface and add new types**

In `src/types/portal.ts`, replace the `TemplateField` interface and add new types. Find this block (around line 156):

```typescript
export interface TemplateField {
  fieldName: string;
  mode: MatchMode;
  tolerance?: number;
}
```

Replace with:

```typescript
export interface TemplateField {
  portalFieldName: string;
  documentFieldName: string;
  mode: MatchMode;
  tolerance?: number;
}

// ─── Required Documents ────────────────────────────────────────

export const REQUIRED_DOCUMENT_RULES = ["required", "one_of"] as const;
export type RequiredDocumentRule = (typeof REQUIRED_DOCUMENT_RULES)[number];

export interface RequiredDocument {
  documentTypeName: string;
  rule: RequiredDocumentRule;
  group?: string;
}

// ─── Business Rules ────────────────────────────────────────────

export const BUSINESS_RULE_SEVERITIES = ["critical", "warning", "info"] as const;
export type BusinessRuleSeverity = (typeof BUSINESS_RULE_SEVERITIES)[number];

export const BUSINESS_RULE_CATEGORIES = [
  "Amount Validation",
  "Document Check",
  "Line Item Check",
  "Duplicate Detection",
  "Compliance Check",
] as const;

export interface BusinessRule {
  id: string;
  rule: string;
  category: string;
  severity: BusinessRuleSeverity;
}

// ─── AI Response Types (business rules + required docs) ────────

export interface BusinessRuleResult {
  rule: string;
  category: string;
  status: "PASS" | "FAIL" | "WARNING" | "NOT_APPLICABLE";
  evidence: string;
  notes?: string;
}

export interface RequiredDocumentCheck {
  documentTypeName: string;
  found: boolean;
  notes?: string;
}
```

- [ ] **Step 2: Update `ComparisonTemplateSummary`**

In `src/types/portal.ts`, find `ComparisonTemplateSummary` (around line 162) and add the new fields:

```typescript
export interface ComparisonTemplateSummary {
  id: string;
  portalId: string;
  name: string;
  groupingKey: Record<string, string>;
  fields: TemplateField[];
  requiredDocuments: RequiredDocument[];
  businessRules: BusinessRule[];
  createdAt: string;
  updatedAt: string;
}
```

- [ ] **Step 3: Update FWA constants**

In `src/types/portal.ts`, find the `FWA_RULE_TYPES` Set and `FWA_LABELS` Record (around line 26) and add:

```typescript
export const FWA_RULE_TYPES = new Set([
  "TAMPERING", "ANOMALY", "DUPLICATE", "DOCUMENT_METADATA",
  "VISUAL_FORENSICS", "ARITHMETIC_INCONSISTENCY", "DOC_TYPE_MATCH",
  "BUSINESS_RULE", "REQUIRED_DOCUMENT",
]);

export const FWA_LABELS: Record<string, string> = {
  TAMPERING: "Tampering",
  ANOMALY: "Anomaly",
  DUPLICATE: "Duplicate",
  DOCUMENT_METADATA: "Metadata",
  VISUAL_FORENSICS: "Forgery",
  ARITHMETIC_INCONSISTENCY: "Math Error",
  DOC_TYPE_MATCH: "Wrong Doc Type",
  BUSINESS_RULE: "Rule Violation",
  REQUIRED_DOCUMENT: "Missing Document",
};
```

- [ ] **Step 4: Update validation schemas**

In `src/lib/validations/portal.ts`, replace `templateFieldSchema` and update the create/update schemas:

```typescript
export const templateFieldSchema = z.object({
  portalFieldName: z.string().min(1).max(200),
  documentFieldName: z.string().min(1).max(200),
  mode: z.enum(["fuzzy", "exact", "numeric"]),
  tolerance: z.number().min(0).max(1000).optional(),
});

export const requiredDocumentSchema = z.object({
  documentTypeName: z.string().min(1).max(200),
  rule: z.enum(["required", "one_of"]),
  group: z.string().max(100).optional(),
});

export const businessRuleSchema = z.object({
  id: z.string().min(1).max(50),
  rule: z.string().min(1).max(1000),
  category: z.string().min(1).max(200),
  severity: z.enum(["critical", "warning", "info"]),
});

export const createComparisonTemplateSchema = z.object({
  name: z.string().min(1).max(200),
  groupingKey: z.record(z.string().max(200), z.string().max(500)),
  fields: z.array(templateFieldSchema).max(100).default([]),
  requiredDocuments: z.array(requiredDocumentSchema).max(20).default([]),
  businessRules: z.array(businessRuleSchema).max(50).default([]),
});

export type CreateComparisonTemplateInput = z.infer<typeof createComparisonTemplateSchema>;

export const updateComparisonTemplateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  fields: z.array(templateFieldSchema).max(100).optional(),
  requiredDocuments: z.array(requiredDocumentSchema).max(20).optional(),
  businessRules: z.array(businessRuleSchema).max(50).optional(),
});

export type UpdateComparisonTemplateInput = z.infer<typeof updateComparisonTemplateSchema>;
```

Note: `fields` minimum changed from `.min(1)` to `.max(100).default([])` on create — templates can now be created with just a name + grouping key, then configured on the detail page.

- [ ] **Step 5: Commit**

```bash
git add src/types/portal.ts src/lib/validations/portal.ts
git commit -m "feat: claims logic types and schemas"
```

---

## Task 2: Prisma Schema + Migration

**Files:**
- Modify: `prisma/schema.prisma:455-469`
- Create: migration SQL

- [ ] **Step 1: Update Prisma schema**

In `prisma/schema.prisma`, find the `ComparisonTemplate` model and add two JSON columns:

```prisma
model ComparisonTemplate {
  id                String   @id @default(cuid())
  portalId          String
  name              String
  groupingKey       Json     @default("{}")
  fields            Json     @default("[]")
  requiredDocuments Json     @default("[]")
  businessRules     Json     @default("[]")
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  portal Portal @relation(fields: [portalId], references: [id], onDelete: Cascade)

  @@unique([portalId, name])
  @@index([portalId])
  @@map("comparison_templates")
}
```

- [ ] **Step 2: Create migration**

```bash
npx prisma migrate dev --name add_claims_logic_to_templates
```

This generates the migration SQL automatically. The default `"[]"` means existing templates get empty arrays — backward compatible.

- [ ] **Step 3: Write data migration for existing `fields` JSON**

Existing templates store `{ fieldName, mode, tolerance }`. We need to transform them to `{ portalFieldName, documentFieldName, mode, tolerance }`. Run this SQL after the schema migration:

```sql
UPDATE comparison_templates
SET fields = (
  SELECT jsonb_agg(
    jsonb_build_object(
      'portalFieldName', elem->>'fieldName',
      'documentFieldName', elem->>'fieldName',
      'mode', elem->>'mode',
      'tolerance', elem->'tolerance'
    )
  )
  FROM jsonb_array_elements(fields::jsonb) AS elem
)
WHERE jsonb_array_length(fields::jsonb) > 0;
```

Create this as a script at `prisma/migrations/data-migrate-template-fields.sql` and run it:

```bash
# Local:
docker exec -i ivm-postgres psql -U ivm -d ivm < prisma/migrations/data-migrate-template-fields.sql
```

- [ ] **Step 4: Regenerate Prisma client**

```bash
npx prisma generate
```

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat: add claims logic columns to templates"
```

---

## Task 3: AI Prompt Builder

**Files:**
- Create: `src/lib/ai/prompt-builder.ts`
- Modify: `src/lib/ai/prompts-comparison.ts:40-67`

- [ ] **Step 1: Create prompt builder utility**

Create `src/lib/ai/prompt-builder.ts`:

```typescript
import type { TemplateField, RequiredDocument, BusinessRule } from "@/types/portal";

interface FullPromptConfig {
  fields: TemplateField[];
  businessRules: BusinessRule[];
  requiredDocuments: RequiredDocument[];
  pageFields: Record<string, string>;
  pdfFields: Record<string, string>;
  documentTypesFound: string[];
}

export function getFullComparisonSystemPrompt(): string {
  return `You are an expert data comparison and claims validation analyst. Your job is to:
1. Compare structured data from a web portal page against data extracted from PDF/document files
2. Evaluate business rules against all available data
3. Check if required documents are present

You will receive field mappings, business rules, required documents, and data from both sources.

Return ONLY valid JSON with this exact structure:
{
  "fieldComparisons": [
    {
      "fieldName": "Human-readable field name (use portal field name)",
      "pageValue": "Value from the portal page (or null if not found)",
      "pdfValue": "Value from the PDF (or null if not found)",
      "status": "MATCH" | "MISMATCH" | "MISSING_IN_PDF" | "MISSING_ON_PAGE" | "UNCERTAIN",
      "confidence": 0.0 to 1.0,
      "notes": "Optional explanation"
    }
  ],
  "businessRuleResults": [
    {
      "rule": "The exact rule text",
      "category": "The category",
      "status": "PASS" | "FAIL" | "WARNING" | "NOT_APPLICABLE",
      "evidence": "Specific data from the documents supporting this result",
      "notes": "Optional explanation"
    }
  ],
  "requiredDocumentsCheck": [
    {
      "documentTypeName": "The document type name",
      "found": true or false,
      "notes": "Optional explanation"
    }
  ],
  "summary": "Brief narrative summary — highlight key discrepancies and rule violations"
}

FIELD COMPARISON RULES:
1. MATCH: Values are semantically equivalent, even if formatted differently. "27 Mar 2026" and "2026-03-27" are MATCH. "$169.60" and "169.60" are MATCH.
2. MISMATCH: Values clearly differ in meaning or amount.
3. MISSING_IN_PDF: Field exists on portal but no corresponding value in PDF data.
4. MISSING_ON_PAGE: Field exists in PDF but no corresponding field on portal.
5. UNCERTAIN: Cannot determine with reasonable confidence.
6. Match fields by the explicit pairs provided — use the portal↔document field name mapping.
7. For monetary amounts, compare numerical values regardless of currency symbols.
8. For dates, compare actual date regardless of format.
9. Confidence: 0.95+ for clear match/mismatch, 0.7-0.94 for probable, below 0.7 for uncertain.

BUSINESS RULE EVALUATION:
1. Evaluate each rule against ALL available data (portal fields, PDF fields, document types).
2. PASS: The condition is satisfied.
3. FAIL: The condition is violated — provide specific evidence.
4. WARNING: The condition may be violated but evidence is ambiguous.
5. NOT_APPLICABLE: The rule does not apply to this data (e.g., "check CPF deduction" when there is no CPF deduction).
6. Always provide evidence — cite specific values from the data.

REQUIRED DOCUMENTS CHECK:
1. Check if each required document type appears in the "Documents found" list.
2. For "one_of" groups, at least one document in the group must be present.
3. Use semantic matching — "Tax Invoice" matches "Invoice", "Medical Receipt" matches "Receipt".

Return ONLY valid JSON — no markdown fences, no explanation outside the JSON.`;
}

export function buildFullComparisonUserPrompt(config: FullPromptConfig): string {
  const { fields, businessRules, requiredDocuments, pageFields, pdfFields, documentTypesFound } = config;

  const fieldMappingLines = fields.map((f) => {
    const modeDesc = f.mode === "exact"
      ? "EXACT match required — any difference is MISMATCH"
      : f.mode === "numeric"
        ? `NUMERIC comparison — values within ${f.tolerance ?? 0} tolerance are MATCH`
        : "FUZZY match — ignore formatting differences (dates, names, whitespace, currency symbols)";
    return `- Portal "${f.portalFieldName}" ↔ Document "${f.documentFieldName}" — ${modeDesc}`;
  }).join("\n");

  const severityLabel = (s: string) => s === "critical" ? "CRITICAL" : s === "warning" ? "WARNING" : "INFO";

  const ruleLines = businessRules.map((r, i) =>
    `${i + 1}. [${severityLabel(r.severity)}] ${r.rule}`
  ).join("\n");

  const requiredDocLines = requiredDocuments.map((rd) => {
    if (rd.rule === "one_of" && rd.group) {
      return `- "${rd.documentTypeName}" — ONE OF group "${rd.group}" (at least one in this group must be present)`;
    }
    return `- "${rd.documentTypeName}" — REQUIRED`;
  }).join("\n");

  let prompt = `Compare the following portal claim record against submitted documents.\n`;

  if (fields.length > 0) {
    prompt += `\n## 1. Field Mappings (compare these pairs)\n${fieldMappingLines}\n`;
  }

  if (businessRules.length > 0) {
    prompt += `\n## 2. Business Rules (evaluate each against ALL available data)\n${ruleLines}\n`;
  }

  if (requiredDocuments.length > 0) {
    prompt += `\n## 3. Required Documents (check presence)\n${requiredDocLines}\nDocuments found: ${JSON.stringify(documentTypesFound)}\n`;
  }

  prompt += `\n## Portal Page Fields\n${JSON.stringify(pageFields, null, 2)}\n`;
  prompt += `\n## PDF Extracted Fields\n${JSON.stringify(pdfFields, null, 2)}\n`;
  prompt += `\nReturn the JSON comparison result with fieldComparisons${businessRules.length > 0 ? ", businessRuleResults" : ""}${requiredDocuments.length > 0 ? ", requiredDocumentsCheck" : ""}, and summary.`;

  return prompt;
}

/**
 * Build a preview of the AI prompt with placeholder data markers.
 * Used by the frontend prompt preview card.
 */
export function buildPromptPreview(config: {
  fields: TemplateField[];
  businessRules: BusinessRule[];
  requiredDocuments: RequiredDocument[];
}): string {
  const preview = buildFullComparisonUserPrompt({
    ...config,
    pageFields: { "<<Portal fields will be injected at runtime>>": "" },
    pdfFields: { "<<PDF extracted fields will be injected at runtime>>": "" },
    documentTypesFound: ["<<Detected from uploaded files at runtime>>"],
  });

  return `${getFullComparisonSystemPrompt()}\n\n---\n\n${preview}`;
}
```

- [ ] **Step 2: Update existing `getTemplatedComparisonUserPrompt` for field alias support**

In `src/lib/ai/prompts-comparison.ts`, update the `getTemplatedComparisonUserPrompt` function to use `portalFieldName` and `documentFieldName`. Replace the existing function (lines 40-67):

```typescript
export function getTemplatedComparisonUserPrompt(
  pageFields: Record<string, string>,
  pdfFields: Record<string, string>,
  templateFields: TemplateField[]
): string {
  const rules = templateFields.map((f) => {
    const portalName = f.portalFieldName ?? (f as Record<string, unknown>).fieldName ?? "";
    const docName = f.documentFieldName ?? portalName;
    if (f.mode === "exact") return `- Portal "${portalName}" ↔ Document "${docName}": EXACT match required — any difference is MISMATCH`;
    if (f.mode === "numeric") {
      const tol = f.tolerance ?? 0;
      return `- Portal "${portalName}" ↔ Document "${docName}": NUMERIC comparison — values within ${tol} tolerance are MATCH`;
    }
    return `- Portal "${portalName}" ↔ Document "${docName}": FUZZY match — ignore formatting differences (dates, names, whitespace, currency symbols)`;
  }).join("\n");

  return `Compare the following data from a web portal page against data extracted from associated PDF documents.

IMPORTANT: Only compare the fields listed below. Ignore all other fields.

## Matching Rules
${rules}

## Portal Page Fields
${JSON.stringify(pageFields, null, 2)}

## PDF Extracted Fields
${JSON.stringify(pdfFields, null, 2)}

Return the JSON comparison result. Only include the fields specified in the matching rules above.`;
}
```

Note the fallback `(f as Record<string, unknown>).fieldName` — handles any templates not yet migrated.

- [ ] **Step 3: Commit**

```bash
git add src/lib/ai/prompt-builder.ts src/lib/ai/prompts-comparison.ts
git commit -m "feat: combined AI prompt builder"
```

---

## Task 4: Expand AI Comparison Response Parsing

**Files:**
- Modify: `src/lib/ai/comparison.ts:18-27, 120-155`

- [ ] **Step 1: Update `ComparisonResponse` interface**

In `src/lib/ai/comparison.ts`, update the interface and imports. At the top of the file, update the import:

```typescript
import type { FieldComparison, ComparisonFieldStatus, TemplateField, BusinessRuleResult, RequiredDocumentCheck } from "@/types/portal";
```

Update `ComparisonResponse` (around line 22):

```typescript
export interface ComparisonResponse {
  fieldComparisons: FieldComparison[];
  matchCount: number;
  mismatchCount: number;
  summary: string;
  rawResponse: unknown;
  businessRuleResults?: BusinessRuleResult[];
  requiredDocumentsCheck?: RequiredDocumentCheck[];
}
```

- [ ] **Step 2: Update `parseComparisonResponse` to extract new sections**

Replace the `parseComparisonResponse` function (around line 124):

```typescript
function parseComparisonResponse(rawText: string): Omit<ComparisonResponse, "rawResponse"> {
  const cleaned = stripMarkdownFences(rawText);

  try {
    const parsed = JSON.parse(cleaned);
    const comparisons: FieldComparison[] = (parsed.fieldComparisons ?? []).map(
      (fc: Record<string, unknown>) => ({
        fieldName: String(fc.fieldName ?? ""),
        pageValue: fc.pageValue != null ? String(fc.pageValue) : null,
        pdfValue: fc.pdfValue != null ? String(fc.pdfValue) : null,
        status: VALID_STATUSES.includes(fc.status as ComparisonFieldStatus)
          ? (fc.status as ComparisonFieldStatus)
          : "UNCERTAIN",
        confidence: typeof fc.confidence === "number" ? fc.confidence : 0.5,
        notes: fc.notes ? String(fc.notes) : undefined,
      })
    );

    const matchCount = comparisons.filter((c) => c.status === "MATCH").length;
    const mismatchCount = comparisons.filter((c) => c.status === "MISMATCH").length;

    // Parse business rule results (optional)
    const VALID_RULE_STATUSES = ["PASS", "FAIL", "WARNING", "NOT_APPLICABLE"];
    const businessRuleResults: BusinessRuleResult[] | undefined = parsed.businessRuleResults
      ? (parsed.businessRuleResults as Record<string, unknown>[]).map((br) => ({
          rule: String(br.rule ?? ""),
          category: String(br.category ?? ""),
          status: VALID_RULE_STATUSES.includes(br.status as string)
            ? (br.status as BusinessRuleResult["status"])
            : "WARNING",
          evidence: String(br.evidence ?? ""),
          notes: br.notes ? String(br.notes) : undefined,
        }))
      : undefined;

    // Parse required documents check (optional)
    const requiredDocumentsCheck: RequiredDocumentCheck[] | undefined = parsed.requiredDocumentsCheck
      ? (parsed.requiredDocumentsCheck as Record<string, unknown>[]).map((rd) => ({
          documentTypeName: String(rd.documentTypeName ?? ""),
          found: rd.found === true,
          notes: rd.notes ? String(rd.notes) : undefined,
        }))
      : undefined;

    return {
      fieldComparisons: comparisons,
      matchCount,
      mismatchCount,
      summary: String(parsed.summary ?? ""),
      businessRuleResults,
      requiredDocumentsCheck,
    };
  } catch {
    logger.error({ rawText: rawText.slice(0, 500) }, "[ai] Failed to parse comparison response");
    throw new AppError("Failed to parse AI comparison response", 500, "AI_PARSE_ERROR");
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/ai/comparison.ts
git commit -m "feat: parse business rules and required docs from AI"
```

---

## Task 5: Update Template Matching & Filtering

**Files:**
- Modify: `src/lib/comparison-templates.ts:12-15, 93-112`

- [ ] **Step 1: Update `CachedPortalTemplates` to include new fields**

In `src/lib/comparison-templates.ts`, update the cached template interface (around line 12):

```typescript
interface CachedPortalTemplates {
  groupingFields: string[];
  templates: Array<{
    id: string;
    name: string;
    groupingKey: Record<string, string>;
    fields: TemplateField[];
    requiredDocuments: RequiredDocument[];
    businessRules: BusinessRule[];
  }>;
  expiresAt: number;
}
```

Add imports at top:

```typescript
import type { TemplateField, RequiredDocument, BusinessRule } from "@/types/portal";
```

Update the `MatchedTemplate` interface:

```typescript
interface MatchedTemplate {
  id: string;
  name: string;
  fields: TemplateField[];
  requiredDocuments: RequiredDocument[];
  businessRules: BusinessRule[];
}
```

Update the return in `findMatchingTemplate` (around line 78):

```typescript
    return {
      id: template.id,
      name: template.name,
      fields: template.fields,
      requiredDocuments: template.requiredDocuments,
      businessRules: template.businessRules,
    };
```

Update the DB select in `findMatchingTemplate` to include new fields (around line 49):

```typescript
    const [portal, templates] = await Promise.all([
      db.portal.findUnique({ where: { id: portalId }, select: { groupingFields: true } }),
      db.comparisonTemplate.findMany({
        where: { portalId },
        select: { id: true, name: true, groupingKey: true, fields: true, requiredDocuments: true, businessRules: true },
      }),
    ]);
```

- [ ] **Step 2: Update `filterFieldsByTemplate` to use `portalFieldName`**

Replace the `filterFieldsByTemplate` function (around line 93):

```typescript
export function filterFieldsByTemplate(
  pageFields: Record<string, string>,
  pdfFields: Record<string, string>,
  templateFields: TemplateField[]
): { filteredPageFields: Record<string, string>; filteredPdfFields: Record<string, string> } {
  const fieldNames = new Set(
    templateFields.map((f) => {
      const name = f.portalFieldName ?? (f as Record<string, unknown>).fieldName ?? "";
      return (name as string).toLowerCase().trim();
    })
  );

  const filteredPageFields: Record<string, string> = {};
  for (const [key, value] of Object.entries(pageFields)) {
    if (fieldNames.has(key.toLowerCase().trim())) {
      filteredPageFields[key] = value;
    }
  }

  return { filteredPageFields, filteredPdfFields: pdfFields };
}
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/comparison-templates.ts
git commit -m "feat: template matching with business rules"
```

---

## Task 6: Worker Integration

**Files:**
- Modify: `src/workers/item-detail-worker.ts:1-10, 280-356`

- [ ] **Step 1: Add imports**

At the top of `src/workers/item-detail-worker.ts`, add new imports:

```typescript
import { getFullComparisonSystemPrompt, buildFullComparisonUserPrompt } from "@/lib/ai/prompt-builder";
import type { BusinessRule, RequiredDocument, BusinessRuleResult, RequiredDocumentCheck } from "@/types/portal";
```

- [ ] **Step 2: Update comparison block in the worker**

Find the comparison block (around line 289 where `const template = await findMatchingTemplate(...)` is). Replace the comparison section. The key change: when a template has `businessRules.length > 0 || requiredDocuments.length > 0`, use the full combined prompt instead of just `compareFields()`.

After the existing `findMatchingTemplate` call and filtering logic, and before the `compareFields` call, add the logic to detect whether to use the full prompt:

```typescript
        const template = await findMatchingTemplate(portalId, allPageData);

        let comparePageFields = detailData;
        let comparePdfFields = pdfFields;
        let templateFields: TemplateField[] | undefined;
        let businessRules: BusinessRule[] = [];
        let requiredDocuments: RequiredDocument[] = [];

        if (template) {
          templateId = template.id;
          templateFields = template.fields;
          businessRules = template.businessRules ?? [];
          requiredDocuments = template.requiredDocuments ?? [];

          if (templateFields.length > 0) {
            const filtered = filterFieldsByTemplate(detailData, pdfFields, templateFields);
            comparePageFields = filtered.filteredPageFields;
            comparePdfFields = filtered.filteredPdfFields;
          }

          logger.info(
            { templateId: template.id, templateName: template.name, fieldCount: templateFields.length, ruleCount: businessRules.length, reqDocCount: requiredDocuments.length },
            "[detail] Matched template"
          );
        }
```

Then update the comparison call to detect full-prompt mode:

```typescript
        const useFullPrompt = businessRules.length > 0 || requiredDocuments.length > 0;

        if (Object.keys(comparePageFields).length > 0 || Object.keys(comparePdfFields).length > 0) {
          if (useFullPrompt) {
            // Collect document types found from extracted files
            const documentTypesFound: string[] = [];
            for (const field of Object.values(pdfFields)) {
              // The classifiedDocType is stored on the TrackedItemFile
            }
            const itemFiles = await db.trackedItemFile.findMany({
              where: { trackedItemId },
              select: { classifiedDocType: true },
            });
            for (const f of itemFiles) {
              if (f.classifiedDocType && !documentTypesFound.includes(f.classifiedDocType)) {
                documentTypesFound.push(f.classifiedDocType);
              }
            }

            // Build combined prompt
            const systemPrompt = getFullComparisonSystemPrompt();
            const userPrompt = buildFullComparisonUserPrompt({
              fields: templateFields ?? [],
              businessRules,
              requiredDocuments,
              pageFields: comparePageFields,
              pdfFields: comparePdfFields,
              documentTypesFound,
            });

            comparisonResult = await withEventTracking(
              trackedItemId,
              "AI_COMPARE_START", "AI_COMPARE_DONE", "AI_COMPARE_FAIL",
              { provider, pageFieldCount: Object.keys(comparePageFields).length, pdfFieldCount: Object.keys(comparePdfFields).length, templateId, mode: "full" },
              () => compareFields({
                pageFields: comparePageFields,
                pdfFields: comparePdfFields,
                provider,
                apiKey,
                model: textModel,
                templateFields,
                systemPromptOverride: systemPrompt,
                userPromptOverride: userPrompt,
              }),
            );
          } else {
            comparisonResult = await withEventTracking(
              trackedItemId,
              "AI_COMPARE_START", "AI_COMPARE_DONE", "AI_COMPARE_FAIL",
              { provider, pageFieldCount: Object.keys(comparePageFields).length, pdfFieldCount: Object.keys(comparePdfFields).length, templateId },
              () => compareFields({
                pageFields: comparePageFields,
                pdfFields: comparePdfFields,
                provider,
                apiKey,
                model: textModel,
                templateFields,
              }),
            );
          }
        }
```

- [ ] **Step 3: Add `systemPromptOverride` and `userPromptOverride` to `ComparisonRequest`**

In `src/lib/ai/comparison.ts`, update the `ComparisonRequest` interface:

```typescript
export interface ComparisonRequest {
  pageFields: Record<string, string>;
  pdfFields: Record<string, string>;
  provider: AIProvider;
  apiKey: string;
  model?: string;
  templateFields?: TemplateField[];
  systemPromptOverride?: string;
  userPromptOverride?: string;
}
```

Update the `compareFields` function to use the overrides when provided:

```typescript
export async function compareFields(
  request: ComparisonRequest
): Promise<ComparisonResponse> {
  const { provider } = request;

  logger.info(
    { provider, pageFieldCount: Object.keys(request.pageFields).length, pdfFieldCount: Object.keys(request.pdfFields).length },
    "[ai] Starting field comparison"
  );

  const userPrompt = request.userPromptOverride
    ? request.userPromptOverride
    : request.templateFields
      ? getTemplatedComparisonUserPrompt(request.pageFields, request.pdfFields, request.templateFields)
      : getComparisonUserPrompt(request.pageFields, request.pdfFields);

  const systemPrompt = request.systemPromptOverride ?? getComparisonSystemPrompt();

  // ... rest of function uses systemPrompt and userPrompt
  // Update each provider call to use `systemPrompt` instead of `getComparisonSystemPrompt()`
```

Update `compareWithAnthropic`, `compareWithOpenAI`, `compareWithGemini` to accept `systemPrompt` as a parameter instead of calling `getComparisonSystemPrompt()` directly:

```typescript
async function compareWithAnthropic(request: ComparisonRequest, userPrompt: string, systemPrompt: string): Promise<string> {
  const client = new Anthropic({ apiKey: request.apiKey });
  const response = await client.messages.create(
    {
      model: request.model ?? PROVIDER_MODELS.anthropic.defaults.text,
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    },
    { signal: AbortSignal.timeout(30_000) }
  );
  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new AppError("AI returned no text response", 500, "AI_EMPTY_RESPONSE");
  }
  return textBlock.text;
}
```

Apply the same pattern to `compareWithOpenAI` and `compareWithGemini`. Update the calls in `compareFields`:

```typescript
  if (provider === "anthropic") {
    rawText = await compareWithAnthropic(request, userPrompt, systemPrompt);
  } else if (provider === "openai") {
    rawText = await compareWithOpenAI(request, userPrompt, systemPrompt);
  } else if (provider === "gemini") {
    rawText = await compareWithGemini(request, userPrompt, systemPrompt);
  }
```

- [ ] **Step 4: Save business rule + required doc ValidationResults after comparison**

Back in `src/workers/item-detail-worker.ts`, after saving the `ComparisonResult`, add validation result persistence:

```typescript
        // Save business rule validation results
        if (comparisonResult?.businessRuleResults) {
          const ruleValidations = comparisonResult.businessRuleResults
            .filter((br: BusinessRuleResult) => br.status !== "PASS")
            .map((br: BusinessRuleResult) => {
              const configuredRule = businessRules.find((r) => r.rule === br.rule);
              return {
                trackedItemId,
                ruleType: "BUSINESS_RULE",
                status: br.status === "FAIL" ? "FAIL" as const : "WARNING" as const,
                message: `${br.category}: ${br.rule}`,
                metadata: JSON.parse(JSON.stringify({
                  rule: br.rule,
                  category: br.category,
                  severity: configuredRule?.severity ?? "warning",
                  evidence: br.evidence,
                  notes: br.notes,
                  aiStatus: br.status,
                })),
              };
            });

          if (ruleValidations.length > 0) {
            await db.validationResult.createMany({ data: ruleValidations });
          }
        }

        // Save required document validation results (failures only)
        if (comparisonResult?.requiredDocumentsCheck) {
          const docValidations = comparisonResult.requiredDocumentsCheck
            .filter((rd: RequiredDocumentCheck) => !rd.found)
            .map((rd: RequiredDocumentCheck) => ({
              trackedItemId,
              ruleType: "REQUIRED_DOCUMENT",
              status: "FAIL" as const,
              message: `Required document not found: ${rd.documentTypeName}`,
              metadata: JSON.parse(JSON.stringify({
                documentTypeName: rd.documentTypeName,
                notes: rd.notes,
              })),
            }));

          if (docValidations.length > 0) {
            await db.validationResult.createMany({ data: docValidations });
          }
        }
```

- [ ] **Step 5: Update final status determination**

After the validation saves, update the status logic to also consider business rule failures:

```typescript
        const hasRuleViolation = comparisonResult?.businessRuleResults?.some(
          (br: BusinessRuleResult) => br.status === "FAIL"
        ) ?? false;
        const hasMissingDoc = comparisonResult?.requiredDocumentsCheck?.some(
          (rd: RequiredDocumentCheck) => !rd.found
        ) ?? false;

        const hasMismatch = (comparisonResult?.mismatchCount ?? 0) > 0;
        const finalStatus = noDocuments
          ? "REQUIRE_DOC"
          : (hasMismatch || hasRuleViolation || hasMissingDoc) ? "FLAGGED" : "COMPARED";
```

- [ ] **Step 6: Commit**

```bash
git add src/workers/item-detail-worker.ts src/lib/ai/comparison.ts
git commit -m "feat: worker uses combined prompt for claims logic"
```

---

## Task 7: Update Recompare API

**Files:**
- Modify: `src/app/api/portals/[id]/scrape/[sessionId]/recompare/route.ts`

- [ ] **Step 1: Update recompare to clear old validation results and use full prompt**

Add imports at top:

```typescript
import { getFullComparisonSystemPrompt, buildFullComparisonUserPrompt } from "@/lib/ai/prompt-builder";
import type { TemplateField, BusinessRule, RequiredDocument, BusinessRuleResult, RequiredDocumentCheck } from "@/types/portal";
```

Inside `processOne`, after the existing `compareFields` call, add cleanup and new validation result creation. Replace the `processOne` function body:

```typescript
    async function processOne(item: typeof matchingItems[0]): Promise<boolean> {
      const detailData = (item.detailData as Record<string, string>) ?? {};
      if (Object.keys(detailData).length === 0) return false;

      const existingComparisons = (item.comparisonResult?.fieldComparisons ?? []) as Array<{
        fieldName: string;
        pdfValue: string | null;
      }>;
      const pdfFields: Record<string, string> = {};
      for (const c of existingComparisons) {
        if (c.pdfValue != null) pdfFields[c.fieldName] = c.pdfValue;
      }

      const { filteredPageFields, filteredPdfFields } = filterFieldsByTemplate(
        detailData,
        pdfFields,
        templateFields
      );

      if (
        Object.keys(filteredPageFields).length === 0 &&
        Object.keys(filteredPdfFields).length === 0
      )
        return false;

      const businessRules = (template.businessRules ?? []) as unknown as BusinessRule[];
      const requiredDocuments = (template.requiredDocuments ?? []) as unknown as RequiredDocument[];
      const useFullPrompt = businessRules.length > 0 || requiredDocuments.length > 0;

      let systemPromptOverride: string | undefined;
      let userPromptOverride: string | undefined;

      if (useFullPrompt) {
        const itemFiles = await db.trackedItemFile.findMany({
          where: { trackedItemId: item.id },
          select: { classifiedDocType: true },
        });
        const documentTypesFound = [...new Set(
          itemFiles.map((f) => f.classifiedDocType).filter(Boolean) as string[]
        )];

        systemPromptOverride = getFullComparisonSystemPrompt();
        userPromptOverride = buildFullComparisonUserPrompt({
          fields: templateFields,
          businessRules,
          requiredDocuments,
          pageFields: filteredPageFields,
          pdfFields: filteredPdfFields,
          documentTypesFound,
        });
      }

      const result = await compareFields({
        pageFields: filteredPageFields,
        pdfFields: filteredPdfFields,
        provider,
        apiKey,
        model: textModel,
        templateFields,
        systemPromptOverride,
        userPromptOverride,
      });

      const comparisonData = {
        provider,
        templateId: resolvedTemplateId,
        fieldComparisons: JSON.parse(JSON.stringify(result.fieldComparisons)),
        matchCount: result.matchCount,
        mismatchCount: result.mismatchCount,
        summary: result.summary,
        completedAt: new Date(),
      };
      await db.comparisonResult.upsert({
        where: { trackedItemId: item.id },
        create: { trackedItemId: item.id, ...comparisonData },
        update: comparisonData,
      });

      // Clear old business rule + required doc validation results
      await db.validationResult.deleteMany({
        where: {
          trackedItemId: item.id,
          ruleType: { in: ["BUSINESS_RULE", "REQUIRED_DOCUMENT"] },
        },
      });

      // Save new business rule results
      if (result.businessRuleResults) {
        const ruleValidations = result.businessRuleResults
          .filter((br) => br.status !== "PASS")
          .map((br) => {
            const configuredRule = businessRules.find((r) => r.rule === br.rule);
            return {
              trackedItemId: item.id,
              ruleType: "BUSINESS_RULE",
              status: br.status === "FAIL" ? "FAIL" as const : "WARNING" as const,
              message: `${br.category}: ${br.rule}`,
              metadata: JSON.parse(JSON.stringify({
                rule: br.rule,
                category: br.category,
                severity: configuredRule?.severity ?? "warning",
                evidence: br.evidence,
                notes: br.notes,
                aiStatus: br.status,
              })),
            };
          });
        if (ruleValidations.length > 0) {
          await db.validationResult.createMany({ data: ruleValidations });
        }
      }

      // Save required document failures
      if (result.requiredDocumentsCheck) {
        const docValidations = result.requiredDocumentsCheck
          .filter((rd) => !rd.found)
          .map((rd) => ({
            trackedItemId: item.id,
            ruleType: "REQUIRED_DOCUMENT",
            status: "FAIL" as const,
            message: `Required document not found: ${rd.documentTypeName}`,
            metadata: JSON.parse(JSON.stringify({ documentTypeName: rd.documentTypeName, notes: rd.notes })),
          }));
        if (docValidations.length > 0) {
          await db.validationResult.createMany({ data: docValidations });
        }
      }

      const hasMismatch = result.mismatchCount > 0;
      const hasRuleViolation = result.businessRuleResults?.some((br) => br.status === "FAIL") ?? false;
      const hasMissingDoc = result.requiredDocumentsCheck?.some((rd) => !rd.found) ?? false;

      await db.trackedItem.update({
        where: { id: item.id },
        data: { status: (hasMismatch || hasRuleViolation || hasMissingDoc) ? "FLAGGED" : "COMPARED" },
      });
      return true;
    }
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/portals/[id]/scrape/[sessionId]/recompare/route.ts
git commit -m "feat: recompare with business rules"
```

---

## Task 8: Update Template API Routes

**Files:**
- Modify: `src/app/api/portals/[id]/templates/route.ts`
- Modify: `src/app/api/portals/[id]/templates/[templateId]/route.ts`

- [ ] **Step 1: Update POST to accept new fields**

In `src/app/api/portals/[id]/templates/route.ts`, update the create handler to store `requiredDocuments` and `businessRules`:

```typescript
    const template = await db.comparisonTemplate.create({
      data: {
        portalId: id,
        name: data.name,
        groupingKey: JSON.parse(JSON.stringify(data.groupingKey)),
        fields: JSON.parse(JSON.stringify(data.fields)),
        requiredDocuments: JSON.parse(JSON.stringify(data.requiredDocuments ?? [])),
        businessRules: JSON.parse(JSON.stringify(data.businessRules ?? [])),
      },
    });
```

- [ ] **Step 2: Update PATCH to accept new fields**

In `src/app/api/portals/[id]/templates/[templateId]/route.ts`, update the PATCH handler:

```typescript
    const updated = await db.comparisonTemplate.updateMany({
      where: { id: templateId, portalId: id },
      data: {
        ...(data.name && { name: data.name }),
        ...(data.fields && { fields: JSON.parse(JSON.stringify(data.fields)) }),
        ...(data.requiredDocuments && { requiredDocuments: JSON.parse(JSON.stringify(data.requiredDocuments)) }),
        ...(data.businessRules && { businessRules: JSON.parse(JSON.stringify(data.businessRules)) }),
      },
    });
```

- [ ] **Step 3: Add prompt preview API**

In `src/app/api/portals/[id]/templates/[templateId]/route.ts`, the existing GET already returns the full template including the new JSON fields. The frontend will compute the prompt preview client-side using `buildPromptPreview()` — no separate API endpoint needed.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/portals/[id]/templates/route.ts src/app/api/portals/[id]/templates/[templateId]/route.ts
git commit -m "feat: template API accepts business rules"
```

---

## Task 9: Template Detail Page (Server Component)

**Files:**
- Create: `src/app/(dashboard)/portals/[id]/templates/[templateId]/page.tsx`

- [ ] **Step 1: Create the server component page**

```typescript
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { TemplateDetailView } from "@/components/portals/template-detail-view";
import type { TemplateField, RequiredDocument, BusinessRule } from "@/types/portal";

interface Props {
  params: Promise<{ id: string; templateId: string }>;
}

export default async function TemplateDetailPage({ params }: Props) {
  const session = await requireAuth();
  const { id: portalId, templateId } = await params;

  const portal = await db.portal.findFirst({
    where: { id: portalId, userId: session.user.id },
    select: { id: true, name: true },
  });
  if (!portal) redirect("/portals");

  const template = await db.comparisonTemplate.findFirst({
    where: { id: templateId, portalId },
  });
  if (!template) redirect(`/portals/${portalId}`);

  // Fetch document types for the required documents selector
  const documentTypes = await db.documentType.findMany({
    where: { userId: session.user.id },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  return (
    <TemplateDetailView
      portalId={portalId}
      portalName={portal.name}
      templateId={template.id}
      templateName={template.name}
      groupingKey={template.groupingKey as Record<string, string>}
      fields={(template.fields as unknown as TemplateField[]) ?? []}
      requiredDocuments={(template.requiredDocuments as unknown as RequiredDocument[]) ?? []}
      businessRules={(template.businessRules as unknown as BusinessRule[]) ?? []}
      documentTypeNames={documentTypes.map((dt) => dt.name)}
    />
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/(dashboard)/portals/[id]/templates/[templateId]/page.tsx
git commit -m "feat: template detail page route"
```

---

## Task 10: Template Detail View (Main Client Component)

**Files:**
- Create: `src/components/portals/template-detail-view.tsx`

- [ ] **Step 1: Create the orchestrator component**

```typescript
"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { TemplateFieldMappings } from "./template-field-mappings";
import { TemplateRequiredDocuments } from "./template-required-documents";
import { TemplateBusinessRules } from "./template-business-rules";
import { TemplatePromptPreview } from "./template-prompt-preview";
import type { TemplateField, RequiredDocument, BusinessRule } from "@/types/portal";

interface TemplateDetailViewProps {
  portalId: string;
  portalName: string;
  templateId: string;
  templateName: string;
  groupingKey: Record<string, string>;
  fields: TemplateField[];
  requiredDocuments: RequiredDocument[];
  businessRules: BusinessRule[];
  documentTypeNames: string[];
}

export function TemplateDetailView({
  portalId,
  portalName,
  templateId,
  templateName,
  groupingKey,
  fields: initialFields,
  requiredDocuments: initialRequiredDocs,
  businessRules: initialBusinessRules,
  documentTypeNames,
}: TemplateDetailViewProps) {
  const [fields, setFields] = useState<TemplateField[]>(initialFields);
  const [requiredDocuments, setRequiredDocuments] = useState<RequiredDocument[]>(initialRequiredDocs);
  const [businessRules, setBusinessRules] = useState<BusinessRule[]>(initialBusinessRules);

  const patchTemplate = useCallback(async (data: Record<string, unknown>) => {
    const res = await fetch(`/api/portals/${portalId}/templates/${templateId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error("Failed to save");
    return res.json();
  }, [portalId, templateId]);

  const handleFieldsChange = useCallback(async (newFields: TemplateField[]) => {
    setFields(newFields);
    await patchTemplate({ fields: newFields });
  }, [patchTemplate]);

  const handleRequiredDocsChange = useCallback(async (newDocs: RequiredDocument[]) => {
    setRequiredDocuments(newDocs);
    await patchTemplate({ requiredDocuments: newDocs });
  }, [patchTemplate]);

  const handleBusinessRulesChange = useCallback(async (newRules: BusinessRule[]) => {
    setBusinessRules(newRules);
    await patchTemplate({ businessRules: newRules });
  }, [patchTemplate]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <Link
          href={`/portals/${portalId}`}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-3"
        >
          <ArrowLeft className="h-4 w-4" />
          {portalName}
        </Link>
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold text-foreground">{templateName}</h1>
          {Object.entries(groupingKey).map(([key, value]) => (
            <Badge key={key} variant="outline" className="text-xs">
              {key}: {value}
            </Badge>
          ))}
        </div>
      </div>

      {/* Card 1: Field Mappings */}
      <TemplateFieldMappings
        fields={fields}
        onChange={handleFieldsChange}
      />

      {/* Card 2: Required Documents */}
      <TemplateRequiredDocuments
        requiredDocuments={requiredDocuments}
        documentTypeNames={documentTypeNames}
        onChange={handleRequiredDocsChange}
      />

      {/* Card 3: Business Rules */}
      <TemplateBusinessRules
        businessRules={businessRules}
        onChange={handleBusinessRulesChange}
      />

      {/* Card 4: AI Prompt Preview */}
      <TemplatePromptPreview
        fields={fields}
        requiredDocuments={requiredDocuments}
        businessRules={businessRules}
      />
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/portals/template-detail-view.tsx
git commit -m "feat: template detail view component"
```

---

## Task 11: Field Mappings Card

**Files:**
- Create: `src/components/portals/template-field-mappings.tsx`

- [ ] **Step 1: Create the field mappings card component**

```typescript
"use client";

import { useState } from "react";
import { Plus, Trash2, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MATCH_MODE_LABELS } from "@/types/portal";
import type { TemplateField, MatchMode } from "@/types/portal";

interface TemplateFieldMappingsProps {
  fields: TemplateField[];
  onChange: (fields: TemplateField[]) => Promise<void>;
}

export function TemplateFieldMappings({ fields, onChange }: TemplateFieldMappingsProps) {
  const [saving, setSaving] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newPortalField, setNewPortalField] = useState("");
  const [newDocField, setNewDocField] = useState("");
  const [newMode, setNewMode] = useState<MatchMode>("fuzzy");
  const [newTolerance, setNewTolerance] = useState(0);

  async function handleSave(newFields: TemplateField[]) {
    setSaving(true);
    try { await onChange(newFields); }
    finally { setSaving(false); }
  }

  async function handleAdd() {
    if (!newPortalField.trim() || !newDocField.trim()) return;
    const field: TemplateField = {
      portalFieldName: newPortalField.trim(),
      documentFieldName: newDocField.trim(),
      mode: newMode,
      ...(newMode === "numeric" ? { tolerance: newTolerance } : {}),
    };
    await handleSave([...fields, field]);
    setNewPortalField("");
    setNewDocField("");
    setNewMode("fuzzy");
    setNewTolerance(0);
    setAdding(false);
  }

  async function handleRemove(index: number) {
    await handleSave(fields.filter((_, i) => i !== index));
  }

  async function handleModeChange(index: number, mode: MatchMode) {
    const updated = fields.map((f, i) =>
      i === index ? { ...f, mode, tolerance: mode === "numeric" ? 0 : undefined } : f
    );
    await handleSave(updated);
  }

  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-medium text-foreground">Field Mappings</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Map portal fields to their corresponding document field names
            </p>
          </div>
          {saving && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        </div>

        {/* Existing mappings table */}
        {fields.length > 0 && (
          <div className="rounded-md border border-border overflow-hidden mb-3">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-muted">
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground">Portal Field</th>
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground">Document Field</th>
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground">Mode</th>
                  <th className="px-3 py-2 w-8"></th>
                </tr>
              </thead>
              <tbody>
                {fields.map((field, i) => (
                  <tr key={i} className="border-t border-border">
                    <td className="px-3 py-2 text-foreground">{field.portalFieldName}</td>
                    <td className="px-3 py-2 text-foreground">{field.documentFieldName}</td>
                    <td className="px-3 py-2">
                      <select
                        value={field.mode}
                        onChange={(e) => handleModeChange(i, e.target.value as MatchMode)}
                        className="rounded border border-border bg-muted px-1.5 py-0.5 text-xs text-foreground"
                      >
                        {(Object.entries(MATCH_MODE_LABELS) as [MatchMode, string][]).map(
                          ([mode, label]) => <option key={mode} value={mode}>{label}</option>
                        )}
                      </select>
                      {field.mode === "numeric" && (
                        <span className="ml-1 text-muted-foreground">
                          ±{field.tolerance ?? 0}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <button
                        onClick={() => handleRemove(i)}
                        className="text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Add new mapping */}
        {adding ? (
          <div className="rounded-md border border-border p-3 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Portal Field</label>
                <Input
                  value={newPortalField}
                  onChange={(e) => setNewPortalField(e.target.value)}
                  placeholder="e.g., Provider"
                  className="h-8 text-xs"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Document Field</label>
                <Input
                  value={newDocField}
                  onChange={(e) => setNewDocField(e.target.value)}
                  placeholder="e.g., Clinic Name"
                  className="h-8 text-xs"
                />
              </div>
            </div>
            <div className="flex items-center gap-3">
              <select
                value={newMode}
                onChange={(e) => setNewMode(e.target.value as MatchMode)}
                className="rounded border border-border bg-muted px-2 py-1.5 text-xs text-foreground"
              >
                {(Object.entries(MATCH_MODE_LABELS) as [MatchMode, string][]).map(
                  ([mode, label]) => <option key={mode} value={mode}>{label}</option>
                )}
              </select>
              {newMode === "numeric" && (
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={newTolerance}
                  onChange={(e) => setNewTolerance(parseFloat(e.target.value) || 0)}
                  className="w-20 h-8 text-xs"
                  placeholder="±"
                />
              )}
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={handleAdd} disabled={!newPortalField.trim() || !newDocField.trim()}>
                Add
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setAdding(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <Button variant="outline" size="sm" onClick={() => setAdding(true)} className="text-xs">
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Add Field Mapping
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/portals/template-field-mappings.tsx
git commit -m "feat: field mappings card component"
```

---

## Task 12: Required Documents Card

**Files:**
- Create: `src/components/portals/template-required-documents.tsx`

- [ ] **Step 1: Create the required documents card**

```typescript
"use client";

import { useState } from "react";
import { Plus, Trash2, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { RequiredDocument, RequiredDocumentRule } from "@/types/portal";

interface TemplateRequiredDocumentsProps {
  requiredDocuments: RequiredDocument[];
  documentTypeNames: string[];
  onChange: (docs: RequiredDocument[]) => Promise<void>;
}

export function TemplateRequiredDocuments({
  requiredDocuments,
  documentTypeNames,
  onChange,
}: TemplateRequiredDocumentsProps) {
  const [saving, setSaving] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newDocName, setNewDocName] = useState("");
  const [newRule, setNewRule] = useState<RequiredDocumentRule>("required");
  const [newGroup, setNewGroup] = useState("");

  async function handleSave(newDocs: RequiredDocument[]) {
    setSaving(true);
    try { await onChange(newDocs); }
    finally { setSaving(false); }
  }

  async function handleAdd() {
    if (!newDocName.trim()) return;
    const doc: RequiredDocument = {
      documentTypeName: newDocName.trim(),
      rule: newRule,
      ...(newRule === "one_of" && newGroup.trim() ? { group: newGroup.trim() } : {}),
    };
    await handleSave([...requiredDocuments, doc]);
    setNewDocName("");
    setNewRule("required");
    setNewGroup("");
    setAdding(false);
  }

  async function handleRemove(index: number) {
    await handleSave(requiredDocuments.filter((_, i) => i !== index));
  }

  // Group one_of docs by group name for display
  const groups = new Map<string, RequiredDocument[]>();
  const standalone: Array<{ doc: RequiredDocument; index: number }> = [];
  requiredDocuments.forEach((doc, i) => {
    if (doc.rule === "one_of" && doc.group) {
      const existing = groups.get(doc.group) ?? [];
      existing.push(doc);
      groups.set(doc.group, existing);
    } else {
      standalone.push({ doc, index: i });
    }
  });

  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-medium text-foreground">Required Documents</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Which documents must be present for this claim type. &quot;One Of&quot; means any document in the group satisfies the requirement.
            </p>
          </div>
          {saving && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        </div>

        <div className="space-y-2 mb-3">
          {/* Standalone required docs */}
          {standalone.map(({ doc, index }) => (
            <div key={index} className="flex items-center justify-between rounded-md border border-border px-3 py-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-foreground">{doc.documentTypeName}</span>
                <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">Required</span>
              </div>
              <button onClick={() => handleRemove(index)} className="text-muted-foreground hover:text-destructive">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}

          {/* Grouped one_of docs */}
          {Array.from(groups.entries()).map(([groupName, docs]) => (
            <div key={groupName} className="rounded-md border border-border p-3">
              <div className="flex items-center gap-2 mb-2">
                <span className="rounded bg-accent/10 px-1.5 py-0.5 text-[10px] font-medium text-accent">
                  One Of: {groupName}
                </span>
                <span className="text-[10px] text-muted-foreground">
                  (at least one must be present)
                </span>
              </div>
              <div className="space-y-1">
                {docs.map((doc) => {
                  const origIndex = requiredDocuments.indexOf(doc);
                  return (
                    <div key={origIndex} className="flex items-center justify-between pl-2">
                      <span className="text-xs text-foreground">{doc.documentTypeName}</span>
                      <button onClick={() => handleRemove(origIndex)} className="text-muted-foreground hover:text-destructive">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          {requiredDocuments.length === 0 && !adding && (
            <p className="text-xs text-muted-foreground italic">No required documents configured.</p>
          )}
        </div>

        {/* Add new required doc */}
        {adding ? (
          <div className="rounded-md border border-border p-3 space-y-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Document Type</label>
              {documentTypeNames.length > 0 ? (
                <select
                  value={newDocName}
                  onChange={(e) => setNewDocName(e.target.value)}
                  className="w-full rounded border border-border bg-muted px-2 py-1.5 text-xs text-foreground"
                >
                  <option value="">Select a document type...</option>
                  {documentTypeNames.map((name) => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
              ) : (
                <Input
                  value={newDocName}
                  onChange={(e) => setNewDocName(e.target.value)}
                  placeholder="e.g., Invoice"
                  className="h-8 text-xs"
                />
              )}
            </div>
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-1.5 text-xs">
                <input
                  type="radio"
                  checked={newRule === "required"}
                  onChange={() => setNewRule("required")}
                  className="accent-accent"
                />
                Required
              </label>
              <label className="flex items-center gap-1.5 text-xs">
                <input
                  type="radio"
                  checked={newRule === "one_of"}
                  onChange={() => setNewRule("one_of")}
                  className="accent-accent"
                />
                One Of (group)
              </label>
              {newRule === "one_of" && (
                <Input
                  value={newGroup}
                  onChange={(e) => setNewGroup(e.target.value)}
                  placeholder="Group name (e.g., primary_doc)"
                  className="h-8 text-xs flex-1"
                />
              )}
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={handleAdd} disabled={!newDocName.trim()}>
                Add
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setAdding(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <Button variant="outline" size="sm" onClick={() => setAdding(true)} className="text-xs">
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Add Document Requirement
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/portals/template-required-documents.tsx
git commit -m "feat: required documents card component"
```

---

## Task 13: Business Rules Card

**Files:**
- Create: `src/components/portals/template-business-rules.tsx`

- [ ] **Step 1: Create the business rules card**

```typescript
"use client";

import { useState } from "react";
import { Plus, Trash2, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { BUSINESS_RULE_CATEGORIES } from "@/types/portal";
import type { BusinessRule, BusinessRuleSeverity } from "@/types/portal";

interface TemplateBusinessRulesProps {
  businessRules: BusinessRule[];
  onChange: (rules: BusinessRule[]) => Promise<void>;
}

const SEVERITY_STYLES: Record<BusinessRuleSeverity, { dot: string; label: string }> = {
  critical: { dot: "bg-status-error", label: "Critical" },
  warning: { dot: "bg-amber-500", label: "Warning" },
  info: { dot: "bg-accent", label: "Info" },
};

export function TemplateBusinessRules({ businessRules, onChange }: TemplateBusinessRulesProps) {
  const [saving, setSaving] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newRule, setNewRule] = useState("");
  const [newCategory, setNewCategory] = useState(BUSINESS_RULE_CATEGORIES[0]);
  const [newCustomCategory, setNewCustomCategory] = useState("");
  const [useCustomCategory, setUseCustomCategory] = useState(false);
  const [newSeverity, setNewSeverity] = useState<BusinessRuleSeverity>("warning");

  async function handleSave(newRules: BusinessRule[]) {
    setSaving(true);
    try { await onChange(newRules); }
    finally { setSaving(false); }
  }

  async function handleAdd() {
    if (!newRule.trim()) return;
    const category = useCustomCategory ? newCustomCategory.trim() : newCategory;
    if (!category) return;

    const rule: BusinessRule = {
      id: crypto.randomUUID(),
      rule: newRule.trim(),
      category,
      severity: newSeverity,
    };
    await handleSave([...businessRules, rule]);
    setNewRule("");
    setNewSeverity("warning");
    setAdding(false);
  }

  async function handleRemove(id: string) {
    await handleSave(businessRules.filter((r) => r.id !== id));
  }

  // Group rules by category
  const byCategory = new Map<string, BusinessRule[]>();
  for (const rule of businessRules) {
    const existing = byCategory.get(rule.category) ?? [];
    existing.push(rule);
    byCategory.set(rule.category, existing);
  }

  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-medium text-foreground">Business Rules</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Conditions the AI will evaluate against the claim data. Written in plain English.
            </p>
          </div>
          {saving && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        </div>

        <div className="space-y-4 mb-3">
          {Array.from(byCategory.entries()).map(([category, rules]) => (
            <div key={category}>
              <p className="text-xs font-medium text-muted-foreground mb-1.5">{category}</p>
              <div className="space-y-1.5">
                {rules.map((rule) => {
                  const style = SEVERITY_STYLES[rule.severity];
                  return (
                    <div
                      key={rule.id}
                      className="flex items-start justify-between gap-2 rounded-md border border-border px-3 py-2"
                    >
                      <div className="flex items-start gap-2 min-w-0">
                        <span
                          className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${style.dot}`}
                          title={style.label}
                        />
                        <span className="text-xs text-foreground">{rule.rule}</span>
                      </div>
                      <button
                        onClick={() => handleRemove(rule.id)}
                        className="text-muted-foreground hover:text-destructive shrink-0 mt-0.5"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          {businessRules.length === 0 && !adding && (
            <p className="text-xs text-muted-foreground italic">No business rules configured.</p>
          )}
        </div>

        {/* Add new rule */}
        {adding ? (
          <div className="rounded-md border border-border p-3 space-y-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Rule (plain English)</label>
              <textarea
                value={newRule}
                onChange={(e) => setNewRule(e.target.value)}
                placeholder="e.g., Outstanding balance / Final Amount Payable must equal $0.00"
                rows={2}
                className="w-full rounded border border-border bg-muted px-2 py-1.5 text-xs text-foreground resize-none"
              />
            </div>
            <div className="flex items-center gap-3">
              <div className="flex-1">
                <label className="text-xs text-muted-foreground mb-1 block">Category</label>
                {useCustomCategory ? (
                  <div className="flex items-center gap-2">
                    <input
                      value={newCustomCategory}
                      onChange={(e) => setNewCustomCategory(e.target.value)}
                      placeholder="Custom category"
                      className="flex-1 rounded border border-border bg-muted px-2 py-1.5 text-xs text-foreground"
                    />
                    <button
                      onClick={() => { setUseCustomCategory(false); setNewCustomCategory(""); }}
                      className="text-xs text-muted-foreground hover:text-foreground"
                    >
                      preset
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <select
                      value={newCategory}
                      onChange={(e) => setNewCategory(e.target.value)}
                      className="flex-1 rounded border border-border bg-muted px-2 py-1.5 text-xs text-foreground"
                    >
                      {BUSINESS_RULE_CATEGORIES.map((cat) => (
                        <option key={cat} value={cat}>{cat}</option>
                      ))}
                    </select>
                    <button
                      onClick={() => setUseCustomCategory(true)}
                      className="text-xs text-muted-foreground hover:text-foreground"
                    >
                      custom
                    </button>
                  </div>
                )}
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Severity</label>
                <div className="flex items-center gap-3">
                  {(["critical", "warning", "info"] as const).map((sev) => {
                    const style = SEVERITY_STYLES[sev];
                    return (
                      <label key={sev} className="flex items-center gap-1.5 text-xs cursor-pointer">
                        <input
                          type="radio"
                          checked={newSeverity === sev}
                          onChange={() => setNewSeverity(sev)}
                          className="accent-accent"
                        />
                        <span className={`h-2 w-2 rounded-full ${style.dot}`} />
                        {style.label}
                      </label>
                    );
                  })}
                </div>
              </div>
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={handleAdd} disabled={!newRule.trim()}>
                Add Rule
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setAdding(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <Button variant="outline" size="sm" onClick={() => setAdding(true)} className="text-xs">
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Add Business Rule
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/portals/template-business-rules.tsx
git commit -m "feat: business rules card component"
```

---

## Task 14: Prompt Preview Card

**Files:**
- Create: `src/components/portals/template-prompt-preview.tsx`

- [ ] **Step 1: Create the prompt preview card**

```typescript
"use client";

import { useMemo, useState } from "react";
import { Copy, Check, Eye } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { buildPromptPreview } from "@/lib/ai/prompt-builder";
import type { TemplateField, RequiredDocument, BusinessRule } from "@/types/portal";

interface TemplatePromptPreviewProps {
  fields: TemplateField[];
  requiredDocuments: RequiredDocument[];
  businessRules: BusinessRule[];
}

export function TemplatePromptPreview({
  fields,
  requiredDocuments,
  businessRules,
}: TemplatePromptPreviewProps) {
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const preview = useMemo(
    () => buildPromptPreview({ fields, requiredDocuments, businessRules }),
    [fields, requiredDocuments, businessRules]
  );

  const isEmpty = fields.length === 0 && requiredDocuments.length === 0 && businessRules.length === 0;

  async function handleCopy() {
    await navigator.clipboard.writeText(preview);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-medium text-foreground">AI Prompt Preview</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              This is what the AI will receive when comparing items of this claim type
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setExpanded(!expanded)}
              className="h-7 text-xs"
            >
              <Eye className="mr-1.5 h-3.5 w-3.5" />
              {expanded ? "Collapse" : "Expand"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleCopy}
              disabled={isEmpty}
              className="h-7 text-xs"
            >
              {copied ? (
                <><Check className="mr-1.5 h-3.5 w-3.5" />Copied</>
              ) : (
                <><Copy className="mr-1.5 h-3.5 w-3.5" />Copy</>
              )}
            </Button>
          </div>
        </div>

        {isEmpty ? (
          <p className="text-xs text-muted-foreground italic">
            Configure field mappings, required documents, or business rules above to see the prompt preview.
          </p>
        ) : (
          <pre
            className={`rounded-md bg-muted p-4 text-xs text-foreground/80 whitespace-pre-wrap font-mono overflow-auto ${
              expanded ? "" : "max-h-64"
            }`}
          >
            {preview}
          </pre>
        )}

        {!isEmpty && (
          <p className="text-[10px] text-muted-foreground mt-2">
            Portal page fields and PDF extracted fields will be injected at runtime with actual data.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/portals/template-prompt-preview.tsx
git commit -m "feat: AI prompt preview card"
```

---

## Task 15: Update Template List to Link to Detail Page

**Files:**
- Modify: `src/components/portals/template-list.tsx`

- [ ] **Step 1: Add navigation to detail page**

In `src/components/portals/template-list.tsx`, add the Link import at the top:

```typescript
import Link from "next/link";
import { ExternalLink } from "lucide-react";
```

For each template row (both in the detected claim types section and the pre-scraped section), add a link button alongside the edit/delete buttons. Find the edit button `<Pencil>` and replace it with a link to the detail page:

Replace the pencil edit button pattern (appears twice — in `preScrapedTemplates.map` and `detectedClaimTypes.map`):

```typescript
                        <Link
                          href={`/portals/${portalId}/templates/${template.id}`}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                        </Link>
```

This replaces the `<Pencil>` edit button that opened inline editing. The inline `TemplateEditor` and all edit state (`editing`, `editFields`, `startEdit`, `cancelEdit`, `handleSaveEdit`) can be removed since editing now happens on the detail page.

Also update the field pills display to show `portalFieldName` instead of `fieldName`:

```typescript
{f.portalFieldName ?? (f as Record<string, unknown>).fieldName ?? ""}
```

Add rule count badge next to field count:

```typescript
<span className="text-[10px] text-muted-foreground ml-1">
  {t.fields.length} fields
  {((t as Record<string, unknown>).businessRules as unknown[] ?? []).length > 0 &&
    ` · ${((t as Record<string, unknown>).businessRules as unknown[]).length} rules`}
</span>
```

- [ ] **Step 2: Update create flow to redirect to detail page**

In the `handleSaveCreate` function, after creating the template, redirect to the detail page instead of staying inline:

```typescript
  async function handleSaveCreate(claimTypeValue: string) {
    setCreateSaving(true);
    setCreateError(null);
    try {
      const groupingKey = groupingField ? { [groupingField]: claimTypeValue } : {};
      const res = await fetch(`/api/portals/${portalId}/templates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: claimTypeValue,
          groupingKey,
          fields: newFields,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message ?? "Failed to save template");
      }
      const created = await res.json();
      // Navigate to detail page for full configuration
      window.location.href = `/portals/${portalId}/templates/${created.id}`;
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setCreateSaving(false);
    }
  }
```

- [ ] **Step 3: Commit**

```bash
git add src/components/portals/template-list.tsx
git commit -m "feat: template list links to detail page"
```

---

## Task 16: Update FWA Display for Multiple Alerts

**Files:**
- Modify: `src/components/portals/tracked-items-table.tsx`

- [ ] **Step 1: Handle multiple FWA alerts per item**

Currently `TrackedItemsTable` shows at most one `fwaAlert` per item. With business rules, an item can have multiple violations. Update the table to show the most severe alert as primary badge, with a count indicator if there are more.

The data for `fwaAlert` comes from the API. Check how the items API aggregates validation results and update accordingly. If the API returns a single `fwaAlert`, the display change is minimal — just ensure the new `ruleType` values render correctly via `FWA_LABELS`.

Since `FWA_LABELS` already has `BUSINESS_RULE` and `REQUIRED_DOCUMENT` entries (from Task 1), and the badge rendering uses `FWA_LABELS[item.fwaAlert.ruleType]` with fallback, the new types will render automatically.

The severity-based coloring (red for FAIL, amber for WARNING) also already works. Business rule results with `severity: "critical"` will produce `status: "FAIL"` validation results, showing as red badges. `severity: "warning"` results show as amber.

No code change needed in the table component itself — it already handles arbitrary `ruleType` values via `FWA_LABELS` lookup.

- [ ] **Step 2: Verify and commit**

```bash
npx tsc --noEmit
git add -A
git commit -m "feat: verify FWA display for new rule types"
```

---

## Task 17: TypeScript Verification & Integration Test

**Files:**
- All modified files

- [ ] **Step 1: Run TypeScript check**

```bash
npx tsc --noEmit
```

Fix any type errors. Common issues to watch for:
- `TemplateField.fieldName` references that need updating to `portalFieldName`
- Missing imports for new types
- JSON casting on Prisma fields

- [ ] **Step 2: Search for remaining `fieldName` references in template code**

```bash
grep -rn "\.fieldName" src/components/portals/template-list.tsx src/components/portals/comparison-template-modal.tsx src/lib/comparison-templates.ts src/lib/ai/prompts-comparison.ts
```

Any remaining `fieldName` references (not `portalFieldName` or `documentFieldName`) in these files need updating with the fallback pattern:
```typescript
f.portalFieldName ?? (f as Record<string, unknown>).fieldName ?? ""
```

- [ ] **Step 3: Commit all fixes**

```bash
git add -A
git commit -m "fix: type errors and field name migration"
```

---

## Summary

| Task | Description | Files |
|------|-------------|-------|
| 1 | Types & validation schemas | `portal.ts`, `validations/portal.ts` |
| 2 | Prisma schema + migration | `schema.prisma`, migration SQL |
| 3 | AI prompt builder | `prompt-builder.ts`, `prompts-comparison.ts` |
| 4 | Expand AI response parsing | `comparison.ts` |
| 5 | Update template matching | `comparison-templates.ts` |
| 6 | Worker integration | `item-detail-worker.ts`, `comparison.ts` |
| 7 | Update recompare API | `recompare/route.ts` |
| 8 | Update template API routes | `templates/route.ts`, `[templateId]/route.ts` |
| 9 | Template detail page | `[templateId]/page.tsx` |
| 10 | Template detail view | `template-detail-view.tsx` |
| 11 | Field mappings card | `template-field-mappings.tsx` |
| 12 | Required documents card | `template-required-documents.tsx` |
| 13 | Business rules card | `template-business-rules.tsx` |
| 14 | Prompt preview card | `template-prompt-preview.tsx` |
| 15 | Update template list | `template-list.tsx` |
| 16 | Update FWA display | `tracked-items-table.tsx` |
| 17 | TypeScript verification | All files |
