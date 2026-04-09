# Comparison Templates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow users to configure per-claim-type comparison templates that control which fields are compared and how (fuzzy/exact/numeric), with inline creation during scrape processing and fallback to full AI comparison for unconfigured types.

**Architecture:** New `ComparisonTemplate` model linked to `Portal`. Portal stores `groupingFields` (JSON array) identifying which scraped fields determine claim type. Worker checks for matching template before comparison — uses template fields/rules if found, falls back to current full-comparison behavior if not. Inline modal appears on first item of an unconfigured type, showing real scraped data.

**Tech Stack:** Prisma migration, Next.js API routes, React client components (modal + settings panel), worker logic changes.

---

### Task 1: Prisma Schema — ComparisonTemplate model + Portal groupingFields

**Files:**
- Modify: `prisma/schema.prisma`
- Modify: `src/types/portal.ts`

- [ ] **Step 1: Add `groupingFields` JSON field to Portal model**

In `prisma/schema.prisma`, add to the `Portal` model after `detailSelectors`:

```prisma
  groupingFields  Json             @default("[]")
```

- [ ] **Step 2: Add ComparisonTemplate model**

Add after the `ComparisonResult` model:

```prisma
model ComparisonTemplate {
  id             String   @id @default(cuid())
  portalId       String
  name           String
  groupingKey    Json     @default("{}")
  fields         Json     @default("[]")
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  portal Portal @relation(fields: [portalId], references: [id], onDelete: Cascade)

  @@unique([portalId, name])
  @@index([portalId])
  @@map("comparison_templates")
}
```

- [ ] **Step 3: Add relation on Portal model**

Add to the `Portal` model relations:

```prisma
  comparisonTemplates ComparisonTemplate[]
```

- [ ] **Step 4: Add `templateId` to ComparisonResult**

Add nullable foreign key to `ComparisonResult`:

```prisma
  templateId       String?
```

- [ ] **Step 5: Run migration**

```bash
npx prisma migrate dev --name add-comparison-templates
```

- [ ] **Step 6: Add TypeScript types to `src/types/portal.ts`**

Add after the existing `ComparisonResultSummary` interface:

```typescript
// ─── Comparison Template ───────────────────────────────────────

export const MATCH_MODES = ["fuzzy", "exact", "numeric"] as const;
export type MatchMode = (typeof MATCH_MODES)[number];

export const MATCH_MODE_LABELS: Record<MatchMode, string> = {
  fuzzy: "Fuzzy (names, dates, text)",
  exact: "Exact match",
  numeric: "Numeric (with tolerance)",
};

export interface TemplateField {
  fieldName: string;
  mode: MatchMode;
  tolerance?: number; // only for numeric mode, e.g. 0.01
}

export interface ComparisonTemplateSummary {
  id: string;
  portalId: string;
  name: string;
  groupingKey: Record<string, string>;
  fields: TemplateField[];
  createdAt: string;
  updatedAt: string;
}
```

- [ ] **Step 7: Add `templateId` and `templateName` to `ComparisonResultSummary`**

Update the existing interface:

```typescript
export interface ComparisonResultSummary {
  id: string;
  provider: string;
  fieldComparisons: FieldComparison[];
  matchCount: number;
  mismatchCount: number;
  summary: string | null;
  completedAt: string | null;
  errorMessage: string | null;
  templateId: string | null;     // add
  templateName: string | null;   // add
}
```

- [ ] **Step 8: Commit**

```bash
git add prisma/schema.prisma src/types/portal.ts
git commit -m "feat: add comparison template schema"
```

---

### Task 2: Zod Validations for Templates

**Files:**
- Modify: `src/lib/validations/portal.ts`

- [ ] **Step 1: Add template validation schemas**

Add at the end of `src/lib/validations/portal.ts`:

```typescript
export const templateFieldSchema = z.object({
  fieldName: z.string().min(1).max(200),
  mode: z.enum(["fuzzy", "exact", "numeric"]),
  tolerance: z.number().min(0).max(1000).optional(),
});

export const createComparisonTemplateSchema = z.object({
  name: z.string().min(1).max(200),
  groupingKey: z.record(z.string().max(200), z.string().max(500)),
  fields: z.array(templateFieldSchema).min(1, "Select at least one field").max(100),
});

export type CreateComparisonTemplateInput = z.infer<typeof createComparisonTemplateSchema>;

export const updateComparisonTemplateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  fields: z.array(templateFieldSchema).min(1).max(100).optional(),
});

export type UpdateComparisonTemplateInput = z.infer<typeof updateComparisonTemplateSchema>;

export const updateGroupingFieldsSchema = z.object({
  groupingFields: z.array(z.string().min(1).max(200)).max(5),
});

export type UpdateGroupingFieldsInput = z.infer<typeof updateGroupingFieldsSchema>;
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/validations/portal.ts
git commit -m "feat: add template validation schemas"
```

---

### Task 3: API Routes — Comparison Templates CRUD

**Files:**
- Create: `src/app/api/portals/[id]/templates/route.ts`
- Create: `src/app/api/portals/[id]/templates/[templateId]/route.ts`
- Create: `src/app/api/portals/[id]/grouping-fields/route.ts`

- [ ] **Step 1: Create list + create endpoint**

Create `src/app/api/portals/[id]/templates/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { errorResponse, NotFoundError } from "@/lib/errors";
import { createComparisonTemplateSchema } from "@/lib/validations/portal";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAuth();
    const { id } = await params;

    const portal = await db.portal.findFirst({
      where: { id, userId: session.user.id },
      select: { id: true },
    });
    if (!portal) throw new NotFoundError("Portal");

    const templates = await db.comparisonTemplate.findMany({
      where: { portalId: id },
      orderBy: { createdAt: "asc" },
    });

    return NextResponse.json(templates);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAuth();
    const { id } = await params;

    const portal = await db.portal.findFirst({
      where: { id, userId: session.user.id },
      select: { id: true },
    });
    if (!portal) throw new NotFoundError("Portal");

    const body = await req.json();
    const data = createComparisonTemplateSchema.parse(body);

    const template = await db.comparisonTemplate.create({
      data: {
        portalId: id,
        name: data.name,
        groupingKey: JSON.parse(JSON.stringify(data.groupingKey)),
        fields: JSON.parse(JSON.stringify(data.fields)),
      },
    });

    return NextResponse.json(template, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
```

- [ ] **Step 2: Create single template GET/PATCH/DELETE endpoint**

Create `src/app/api/portals/[id]/templates/[templateId]/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { errorResponse, NotFoundError } from "@/lib/errors";
import { updateComparisonTemplateSchema } from "@/lib/validations/portal";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; templateId: string }> }
) {
  try {
    const session = await requireAuth();
    const { id, templateId } = await params;

    await db.portal.findFirstOrThrow({
      where: { id, userId: session.user.id },
      select: { id: true },
    });

    const template = await db.comparisonTemplate.findFirst({
      where: { id: templateId, portalId: id },
    });
    if (!template) throw new NotFoundError("Template");

    return NextResponse.json(template);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; templateId: string }> }
) {
  try {
    const session = await requireAuth();
    const { id, templateId } = await params;

    await db.portal.findFirstOrThrow({
      where: { id, userId: session.user.id },
      select: { id: true },
    });

    const body = await req.json();
    const data = updateComparisonTemplateSchema.parse(body);

    const updated = await db.comparisonTemplate.updateMany({
      where: { id: templateId, portalId: id },
      data: {
        ...(data.name && { name: data.name }),
        ...(data.fields && { fields: JSON.parse(JSON.stringify(data.fields)) }),
      },
    });

    if (updated.count === 0) throw new NotFoundError("Template");

    const template = await db.comparisonTemplate.findUnique({
      where: { id: templateId },
    });

    return NextResponse.json(template);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; templateId: string }> }
) {
  try {
    const session = await requireAuth();
    const { id, templateId } = await params;

    await db.portal.findFirstOrThrow({
      where: { id, userId: session.user.id },
      select: { id: true },
    });

    const deleted = await db.comparisonTemplate.deleteMany({
      where: { id: templateId, portalId: id },
    });

    if (deleted.count === 0) throw new NotFoundError("Template");

    return NextResponse.json({ deleted: true });
  } catch (err) {
    return errorResponse(err);
  }
}
```

- [ ] **Step 3: Create grouping fields endpoint**

Create `src/app/api/portals/[id]/grouping-fields/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { errorResponse, NotFoundError } from "@/lib/errors";
import { updateGroupingFieldsSchema } from "@/lib/validations/portal";

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAuth();
    const { id } = await params;

    const portal = await db.portal.findFirst({
      where: { id, userId: session.user.id },
      select: { id: true },
    });
    if (!portal) throw new NotFoundError("Portal");

    const body = await req.json();
    const data = updateGroupingFieldsSchema.parse(body);

    await db.portal.update({
      where: { id },
      data: { groupingFields: JSON.parse(JSON.stringify(data.groupingFields)) },
    });

    return NextResponse.json({ groupingFields: data.groupingFields });
  } catch (err) {
    return errorResponse(err);
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add src/app/api/portals/
git commit -m "feat: add template CRUD API routes"
```

---

### Task 4: Template Matching Logic (shared utility)

**Files:**
- Create: `src/lib/comparison-templates.ts`

- [ ] **Step 1: Create template matching utility**

Create `src/lib/comparison-templates.ts`:

```typescript
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import type { TemplateField } from "@/types/portal";

interface MatchedTemplate {
  id: string;
  name: string;
  fields: TemplateField[];
}

/**
 * Find a matching comparison template for an item based on its data and the portal's grouping fields.
 * Returns null if no grouping fields configured or no template matches.
 */
export async function findMatchingTemplate(
  portalId: string,
  itemData: Record<string, string>
): Promise<MatchedTemplate | null> {
  const portal = await db.portal.findUnique({
    where: { id: portalId },
    select: { groupingFields: true },
  });

  const groupingFields = (portal?.groupingFields ?? []) as string[];
  if (groupingFields.length === 0) return null;

  // Build the grouping key from item data
  const groupingKey: Record<string, string> = {};
  for (const field of groupingFields) {
    const value = itemData[field];
    if (!value) {
      logger.debug({ field, portalId }, "[templates] Grouping field not found in item data");
      return null;
    }
    groupingKey[field] = value;
  }

  // Find template with matching groupingKey
  const templates = await db.comparisonTemplate.findMany({
    where: { portalId },
  });

  for (const template of templates) {
    const tKey = template.groupingKey as Record<string, string>;
    const matches = groupingFields.every(
      (f) => tKey[f]?.toLowerCase().trim() === groupingKey[f]?.toLowerCase().trim()
    );
    if (matches) {
      return {
        id: template.id,
        name: template.name,
        fields: template.fields as TemplateField[],
      };
    }
  }

  return null;
}

/**
 * Filter page/pdf fields to only those specified in the template.
 * Returns the filtered field maps ready for AI comparison.
 */
export function filterFieldsByTemplate(
  pageFields: Record<string, string>,
  pdfFields: Record<string, string>,
  templateFields: TemplateField[]
): { filteredPageFields: Record<string, string>; filteredPdfFields: Record<string, string> } {
  const fieldNames = new Set(templateFields.map((f) => f.fieldName.toLowerCase().trim()));

  const filteredPageFields: Record<string, string> = {};
  for (const [key, value] of Object.entries(pageFields)) {
    if (fieldNames.has(key.toLowerCase().trim())) {
      filteredPageFields[key] = value;
    }
  }

  const filteredPdfFields: Record<string, string> = {};
  for (const [key, value] of Object.entries(pdfFields)) {
    if (fieldNames.has(key.toLowerCase().trim())) {
      filteredPdfFields[key] = value;
    }
  }

  return { filteredPageFields, filteredPdfFields };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/comparison-templates.ts
git commit -m "feat: add template matching utility"
```

---

### Task 5: Update AI Comparison Prompt to Use Template Rules

**Files:**
- Modify: `src/lib/ai/prompts-comparison.ts`
- Modify: `src/lib/ai/comparison.ts`

- [ ] **Step 1: Add template-aware prompt function**

Add to `src/lib/ai/prompts-comparison.ts` after the existing functions:

```typescript
import type { TemplateField } from "@/types/portal";

export function getTemplatedComparisonUserPrompt(
  pageFields: Record<string, string>,
  pdfFields: Record<string, string>,
  templateFields: TemplateField[]
): string {
  const rules = templateFields.map((f) => {
    if (f.mode === "exact") return `- "${f.fieldName}": EXACT match required — any difference is MISMATCH`;
    if (f.mode === "numeric") {
      const tol = f.tolerance ?? 0;
      return `- "${f.fieldName}": NUMERIC comparison — values within ${tol} tolerance are MATCH`;
    }
    return `- "${f.fieldName}": FUZZY match — ignore formatting differences (dates, names, whitespace, currency symbols)`;
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

- [ ] **Step 2: Update `ComparisonRequest` interface to accept template fields**

In `src/lib/ai/comparison.ts`, update the interface:

```typescript
import type { TemplateField } from "@/types/portal";

export interface ComparisonRequest {
  pageFields: Record<string, string>;
  pdfFields: Record<string, string>;
  provider: AIProvider;
  apiKey: string;
  templateFields?: TemplateField[]; // new — if provided, use templated prompt
}
```

- [ ] **Step 3: Update provider functions to use templated prompt when available**

In `src/lib/ai/comparison.ts`, update the `compareWithAnthropic` function (and similarly `compareWithOpenAI` and `compareWithGemini`) to choose the right prompt:

Replace the user prompt generation in all three provider functions. For each, change:

```typescript
content: getComparisonUserPrompt(request.pageFields, request.pdfFields),
```

to:

```typescript
content: request.templateFields
  ? getTemplatedComparisonUserPrompt(request.pageFields, request.pdfFields, request.templateFields)
  : getComparisonUserPrompt(request.pageFields, request.pdfFields),
```

Add the import at the top:

```typescript
import { getComparisonSystemPrompt, getComparisonUserPrompt, getTemplatedComparisonUserPrompt } from "./prompts-comparison";
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/ai/prompts-comparison.ts src/lib/ai/comparison.ts
git commit -m "feat: template-aware comparison prompts"
```

---

### Task 6: Update Item Detail Worker — Template Lookup + Filtered Comparison

**Files:**
- Modify: `src/workers/item-detail-worker.ts`

- [ ] **Step 1: Add template lookup before comparison**

In `src/workers/item-detail-worker.ts`, import the new utilities at the top:

```typescript
import { findMatchingTemplate, filterFieldsByTemplate } from "@/lib/comparison-templates";
```

- [ ] **Step 2: Replace the comparison section (lines 175-204)**

Replace the existing AI comparison block with:

```typescript
      // ── Template lookup + AI field comparison ──────────────
      let comparisonResult;
      let templateId: string | null = null;

      if (Object.keys(detailData).length > 0 && Object.keys(pdfFields).length > 0) {
        // Combine list + detail data for grouping key lookup
        const allPageData = {
          ...(item.listData as Record<string, string>),
          ...detailData,
        };
        const template = await findMatchingTemplate(portalId, allPageData);

        let comparePageFields = detailData;
        let comparePdfFields = pdfFields;
        let templateFields: import("@/types/portal").TemplateField[] | undefined;

        if (template) {
          templateId = template.id;
          templateFields = template.fields;
          const filtered = filterFieldsByTemplate(detailData, pdfFields, template.fields);
          comparePageFields = filtered.filteredPageFields;
          comparePdfFields = filtered.filteredPdfFields;

          logger.info(
            { templateId, templateName: template.name, fieldCount: template.fields.length },
            "[worker] Using comparison template"
          );
        } else {
          logger.info("[worker] No matching template, using full comparison");
        }

        if (Object.keys(comparePageFields).length > 0 && Object.keys(comparePdfFields).length > 0) {
          comparisonResult = await withEventTracking(
            trackedItemId,
            "AI_COMPARE_START",
            "AI_COMPARE_DONE",
            "AI_COMPARE_FAIL",
            {
              provider,
              pageFieldCount: Object.keys(comparePageFields).length,
              pdfFieldCount: Object.keys(comparePdfFields).length,
              templateId: templateId ?? undefined,
            },
            () => compareFields({
              pageFields: comparePageFields,
              pdfFields: comparePdfFields,
              provider,
              apiKey,
              templateFields,
            })
          );
        }
      }

      if (comparisonResult) {
        await db.comparisonResult.create({
          data: {
            trackedItemId,
            provider,
            templateId,
            fieldComparisons: JSON.parse(JSON.stringify(comparisonResult.fieldComparisons)),
            matchCount: comparisonResult.matchCount,
            mismatchCount: comparisonResult.mismatchCount,
            summary: comparisonResult.summary,
            completedAt: new Date(),
          },
        });
      }
```

- [ ] **Step 3: Commit**

```bash
git add src/workers/item-detail-worker.ts
git commit -m "feat: worker uses comparison templates"
```

---

### Task 7: Inline Template Configuration Modal

**Files:**
- Create: `src/components/portals/comparison-template-modal.tsx`

- [ ] **Step 1: Create the modal component**

Create `src/components/portals/comparison-template-modal.tsx`:

```typescript
"use client";

import { useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { MatchMode, TemplateField } from "@/types/portal";
import { MATCH_MODE_LABELS } from "@/types/portal";

interface FieldOption {
  name: string;
  source: "page" | "pdf" | "both";
  pageValue?: string;
  pdfValue?: string;
}

interface ComparisonTemplateModalProps {
  portalId: string;
  groupingKey: Record<string, string>;
  suggestedName: string;
  availableFields: FieldOption[];
  onSaved: (templateId: string) => void;
  onSkip: () => void;
}

export function ComparisonTemplateModal({
  portalId,
  groupingKey,
  suggestedName,
  availableFields,
  onSaved,
  onSkip,
}: ComparisonTemplateModalProps) {
  const [selectedFields, setSelectedFields] = useState<TemplateField[]>([]);
  const [saving, setSaving] = useState(false);

  function addField(name: string) {
    if (selectedFields.some((f) => f.fieldName === name)) return;
    setSelectedFields((prev) => [...prev, { fieldName: name, mode: "fuzzy" }]);
  }

  function removeField(name: string) {
    setSelectedFields((prev) => prev.filter((f) => f.fieldName !== name));
  }

  function updateMode(name: string, mode: MatchMode) {
    setSelectedFields((prev) =>
      prev.map((f) => (f.fieldName === name ? { ...f, mode, tolerance: mode === "numeric" ? 0.01 : undefined } : f))
    );
  }

  function updateTolerance(name: string, tolerance: number) {
    setSelectedFields((prev) =>
      prev.map((f) => (f.fieldName === name ? { ...f, tolerance } : f))
    );
  }

  async function handleSave() {
    if (selectedFields.length === 0) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/portals/${portalId}/templates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: suggestedName,
          groupingKey,
          fields: selectedFields,
        }),
      });
      if (!res.ok) throw new Error("Failed to save template");
      const template = await res.json();
      onSaved(template.id);
    } catch {
      setSaving(false);
    }
  }

  const unselected = availableFields.filter(
    (f) => !selectedFields.some((s) => s.fieldName === f.name)
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
      <Card className="w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
        <CardHeader>
          <CardTitle className="text-base">
            Configure Comparison Template
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            New claim type detected: <strong>{suggestedName}</strong>. Select fields to compare and set matching rules.
          </p>
        </CardHeader>
        <CardContent className="overflow-y-auto flex-1 space-y-4">
          {/* Grouping key display */}
          <div className="flex flex-wrap gap-2">
            {Object.entries(groupingKey).map(([key, value]) => (
              <Badge key={key} variant="secondary">
                {key}: {value}
              </Badge>
            ))}
          </div>

          {/* Available fields to add */}
          {unselected.length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2">Available Fields</p>
              <div className="flex flex-wrap gap-1.5">
                {unselected.map((f) => (
                  <button
                    key={f.name}
                    onClick={() => addField(f.name)}
                    className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-foreground hover:bg-muted transition-colors cursor-pointer"
                  >
                    <Plus className="h-3 w-3" />
                    {f.name}
                    <span className="text-muted-foreground">
                      ({f.source === "both" ? "page+pdf" : f.source})
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Selected fields with rules */}
          {selectedFields.length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2">
                Selected Fields ({selectedFields.length})
              </p>
              <div className="space-y-2">
                {selectedFields.map((field) => {
                  const opt = availableFields.find((f) => f.name === field.fieldName);
                  return (
                    <div
                      key={field.fieldName}
                      className="flex items-center gap-3 rounded-lg border border-border p-3"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground">{field.fieldName}</p>
                        {opt && (
                          <p className="text-xs text-muted-foreground truncate">
                            Page: {opt.pageValue ?? "—"} | PDF: {opt.pdfValue ?? "—"}
                          </p>
                        )}
                      </div>
                      <select
                        value={field.mode}
                        onChange={(e) => updateMode(field.fieldName, e.target.value as MatchMode)}
                        className="rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground"
                      >
                        {(Object.entries(MATCH_MODE_LABELS) as [MatchMode, string][]).map(([mode, label]) => (
                          <option key={mode} value={mode}>{label}</option>
                        ))}
                      </select>
                      {field.mode === "numeric" && (
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={field.tolerance ?? 0}
                          onChange={(e) => updateTolerance(field.fieldName, parseFloat(e.target.value) || 0)}
                          className="w-20 rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground"
                          placeholder="Tolerance"
                        />
                      )}
                      <button
                        onClick={() => removeField(field.fieldName)}
                        className="text-muted-foreground hover:text-status-error cursor-pointer"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </CardContent>

        <div className="flex items-center justify-between border-t border-border p-4">
          <Button variant="ghost" size="sm" onClick={onSkip}>
            Skip (use full comparison)
          </Button>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={selectedFields.length === 0 || saving}
          >
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save Template ({selectedFields.length} fields)
          </Button>
        </div>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/portals/comparison-template-modal.tsx
git commit -m "feat: comparison template config modal"
```

---

### Task 8: API Route — Get Unconfigured Claim Types for a Session

**Files:**
- Create: `src/app/api/portals/[id]/scrape/[sessionId]/unconfigured-types/route.ts`

- [ ] **Step 1: Create endpoint that returns items with unconfigured claim types**

This endpoint is called by the session items page to check if any items need template configuration. It returns the first item of each unconfigured type with its field data.

Create `src/app/api/portals/[id]/scrape/[sessionId]/unconfigured-types/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { errorResponse, NotFoundError } from "@/lib/errors";
import { findMatchingTemplate } from "@/lib/comparison-templates";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; sessionId: string }> }
) {
  try {
    const session = await requireAuth();
    const { id, sessionId } = await params;

    const portal = await db.portal.findFirst({
      where: { id, userId: session.user.id },
      select: { id: true, groupingFields: true },
    });
    if (!portal) throw new NotFoundError("Portal");

    const groupingFields = (portal.groupingFields ?? []) as string[];
    if (groupingFields.length === 0) {
      return NextResponse.json({ unconfiguredTypes: [], needsGroupingConfig: true });
    }

    // Get completed items that used full comparison (no template)
    const items = await db.trackedItem.findMany({
      where: {
        scrapeSessionId: sessionId,
        status: { in: ["COMPARED", "FLAGGED"] },
        comparisonResult: { templateId: null },
      },
      select: {
        id: true,
        listData: true,
        detailData: true,
        comparisonResult: {
          select: { fieldComparisons: true },
        },
      },
      take: 100,
    });

    // Group by claim type, find unique unconfigured types
    const seen = new Map<string, { groupingKey: Record<string, string>; itemId: string; pageFields: string[]; pdfFields: string[] }>();

    for (const item of items) {
      const allData = {
        ...(item.listData as Record<string, string>),
        ...(item.detailData as Record<string, string> ?? {}),
      };

      const keyParts: Record<string, string> = {};
      let hasAllFields = true;
      for (const f of groupingFields) {
        if (allData[f]) {
          keyParts[f] = allData[f];
        } else {
          hasAllFields = false;
        }
      }
      if (!hasAllFields) continue;

      const keyStr = JSON.stringify(keyParts);
      if (seen.has(keyStr)) continue;

      // Check if template already exists
      const template = await findMatchingTemplate(id, allData);
      if (template) continue;

      // Extract unique field names from comparison result
      const comparisons = (item.comparisonResult?.fieldComparisons ?? []) as Array<{
        fieldName: string;
        pageValue: string | null;
        pdfValue: string | null;
      }>;

      const pageFields = comparisons
        .filter((c) => c.pageValue != null)
        .map((c) => c.fieldName);
      const pdfFields = comparisons
        .filter((c) => c.pdfValue != null)
        .map((c) => c.fieldName);

      seen.set(keyStr, {
        groupingKey: keyParts,
        itemId: item.id,
        pageFields: [...new Set(pageFields)],
        pdfFields: [...new Set(pdfFields)],
      });
    }

    return NextResponse.json({
      unconfiguredTypes: Array.from(seen.values()),
      needsGroupingConfig: false,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/portals/
git commit -m "feat: unconfigured types detection API"
```

---

### Task 9: API Route — Re-compare Items with Template

**Files:**
- Create: `src/app/api/portals/[id]/scrape/[sessionId]/recompare/route.ts`

- [ ] **Step 1: Create recompare endpoint**

After the user saves a template, this endpoint re-queues items of that type for reprocessing with the template applied.

Create `src/app/api/portals/[id]/scrape/[sessionId]/recompare/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { errorResponse, NotFoundError, ValidationError } from "@/lib/errors";
import { resolveProviderAndKey } from "@/lib/ai/resolve-provider";
import { compareFields } from "@/lib/ai/comparison";
import { findMatchingTemplate, filterFieldsByTemplate } from "@/lib/comparison-templates";
import { logger } from "@/lib/logger";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; sessionId: string }> }
) {
  try {
    const session = await requireAuth();
    const { id, sessionId } = await params;

    const portal = await db.portal.findFirst({
      where: { id, userId: session.user.id },
      select: { id: true, groupingFields: true },
    });
    if (!portal) throw new NotFoundError("Portal");

    const body = await req.json();
    const templateId = body.templateId as string;
    if (!templateId) throw new ValidationError("templateId is required");

    const template = await db.comparisonTemplate.findFirst({
      where: { id: templateId, portalId: id },
    });
    if (!template) throw new NotFoundError("Template");

    const groupingFields = (portal.groupingFields ?? []) as string[];
    const templateKey = template.groupingKey as Record<string, string>;

    // Find items that match this template's grouping key and have no template-based comparison
    const items = await db.trackedItem.findMany({
      where: {
        scrapeSessionId: sessionId,
        status: { in: ["COMPARED", "FLAGGED"] },
        comparisonResult: { templateId: null },
      },
      include: {
        comparisonResult: true,
      },
    });

    const matchingItems = items.filter((item) => {
      const allData = {
        ...(item.listData as Record<string, string>),
        ...(item.detailData as Record<string, string> ?? {}),
      };
      return groupingFields.every(
        (f) => allData[f]?.toLowerCase().trim() === templateKey[f]?.toLowerCase().trim()
      );
    });

    if (matchingItems.length === 0) {
      return NextResponse.json({ recompared: 0 });
    }

    const { provider, apiKey } = await resolveProviderAndKey(session.user.id);
    const templateFields = template.fields as import("@/types/portal").TemplateField[];
    let recompared = 0;

    for (const item of matchingItems) {
      const detailData = (item.detailData as Record<string, string>) ?? {};
      if (Object.keys(detailData).length === 0) continue;

      // Get pdf fields from existing comparison result
      const existingComparisons = (item.comparisonResult?.fieldComparisons ?? []) as Array<{
        fieldName: string;
        pdfValue: string | null;
      }>;
      const pdfFields: Record<string, string> = {};
      for (const c of existingComparisons) {
        if (c.pdfValue) pdfFields[c.fieldName] = c.pdfValue;
      }

      if (Object.keys(pdfFields).length === 0) continue;

      const { filteredPageFields, filteredPdfFields } = filterFieldsByTemplate(
        detailData,
        pdfFields,
        templateFields
      );

      if (Object.keys(filteredPageFields).length === 0 && Object.keys(filteredPdfFields).length === 0) continue;

      try {
        const result = await compareFields({
          pageFields: filteredPageFields,
          pdfFields: filteredPdfFields,
          provider,
          apiKey,
          templateFields,
        });

        // Delete old comparison and create new
        if (item.comparisonResult) {
          await db.comparisonResult.delete({
            where: { id: item.comparisonResult.id },
          });
        }

        await db.comparisonResult.create({
          data: {
            trackedItemId: item.id,
            provider,
            templateId: template.id,
            fieldComparisons: JSON.parse(JSON.stringify(result.fieldComparisons)),
            matchCount: result.matchCount,
            mismatchCount: result.mismatchCount,
            summary: result.summary,
            completedAt: new Date(),
          },
        });

        const hasMismatch = result.mismatchCount > 0;
        await db.trackedItem.update({
          where: { id: item.id },
          data: { status: hasMismatch ? "FLAGGED" : "COMPARED" },
        });

        recompared++;
      } catch (err) {
        logger.warn({ err, itemId: item.id }, "[recompare] Failed to recompare item");
      }
    }

    return NextResponse.json({ recompared, total: matchingItems.length });
  } catch (err) {
    return errorResponse(err);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/portals/
git commit -m "feat: recompare items with template"
```

---

### Task 10: Grouping Field Configuration UI (Portal Detail Page)

**Files:**
- Create: `src/components/portals/grouping-field-config.tsx`
- Modify: `src/components/portals/portal-detail-view.tsx` (add the config section)

- [ ] **Step 1: Create grouping field configuration component**

Create `src/components/portals/grouping-field-config.tsx`:

```typescript
"use client";

import { useState } from "react";
import { Loader2, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface GroupingFieldConfigProps {
  portalId: string;
  currentGroupingFields: string[];
  availableFields: string[];
  onSaved: () => void;
}

export function GroupingFieldConfig({
  portalId,
  currentGroupingFields,
  availableFields,
  onSaved,
}: GroupingFieldConfigProps) {
  const [selected, setSelected] = useState<string[]>(currentGroupingFields);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch(`/api/portals/${portalId}/grouping-fields`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groupingFields: selected }),
      });
      if (!res.ok) throw new Error("Failed to save");
      setEditing(false);
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  function toggleField(field: string) {
    setSelected((prev) =>
      prev.includes(field) ? prev.filter((f) => f !== field) : [...prev, field]
    );
  }

  if (!editing) {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Comparison Grouping</CardTitle>
            <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
              <Settings2 className="mr-2 h-4 w-4" />
              Configure
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {currentGroupingFields.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No grouping fields configured. Set up grouping to enable per-claim-type comparison templates.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {currentGroupingFields.map((f) => (
                <Badge key={f} variant="secondary">{f}</Badge>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Configure Grouping Fields</CardTitle>
        <p className="text-sm text-muted-foreground">
          Select which scraped fields determine the claim type. Items with the same values for these fields will share a comparison template.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {availableFields.map((f) => (
            <button
              key={f}
              onClick={() => toggleField(f)}
              className={`rounded-md border px-2.5 py-1 text-xs transition-colors cursor-pointer ${
                selected.includes(f)
                  ? "border-accent bg-accent/10 text-foreground"
                  : "border-border text-muted-foreground hover:bg-muted"
              }`}
            >
              {f}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <Button size="sm" onClick={handleSave} disabled={selected.length === 0 || saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save
          </Button>
          <Button variant="ghost" size="sm" onClick={() => { setEditing(false); setSelected(currentGroupingFields); }}>
            Cancel
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Wire into portal detail page**

In `src/components/portals/portal-detail-view.tsx`, import and render `GroupingFieldConfig` in the portal settings area. Pass `currentGroupingFields` from portal data and `availableFields` derived from the portal's list selector column names + detail selector field keys.

The exact integration depends on the current layout. Add it after the existing selectors/schedule configuration section:

```tsx
import { GroupingFieldConfig } from "./grouping-field-config";

// Inside the component, compute available fields:
const availableFields = [
  ...(portal.listSelectors?.columns?.map((c) => c.name) ?? []),
  ...Object.keys(portal.detailSelectors?.fieldSelectors ?? {}),
];

// Render in the settings area:
<GroupingFieldConfig
  portalId={portal.id}
  currentGroupingFields={(portal.groupingFields ?? []) as string[]}
  availableFields={availableFields}
  onSaved={() => router.refresh()}
/>
```

- [ ] **Step 3: Commit**

```bash
git add src/components/portals/grouping-field-config.tsx src/components/portals/portal-detail-view.tsx
git commit -m "feat: grouping field configuration UI"
```

---

### Task 11: Session Items Page — Inline Template Prompt

**Files:**
- Modify: `src/app/(dashboard)/portals/[id]/sessions/[sessionId]/page.tsx`
- Modify: `src/components/portals/session-actions.tsx`

- [ ] **Step 1: Add template prompt banner to session items page**

In the session items page server component, pass `portalId` and `groupingFields` to the client components. In `session-actions.tsx`, add logic to:

1. After items finish processing (`isComplete && counts.COMPARED + counts.FLAGGED > 0`), fetch `/api/portals/${portalId}/scrape/${sessionId}/unconfigured-types`
2. If unconfigured types exist, show an info banner: "N claim types have no comparison template. Configure templates for more accurate matching."
3. Clicking "Configure" opens the `ComparisonTemplateModal` for the first unconfigured type
4. After saving a template, call `/api/portals/${portalId}/scrape/${sessionId}/recompare` with the new templateId
5. Cycle through remaining unconfigured types

Add to `session-actions.tsx` after the existing action buttons:

```tsx
import { ComparisonTemplateModal } from "./comparison-template-modal";

// Add state for unconfigured types:
const [unconfiguredTypes, setUnconfiguredTypes] = useState<Array<{
  groupingKey: Record<string, string>;
  itemId: string;
  pageFields: string[];
  pdfFields: string[];
}>>([]);
const [showTemplateModal, setShowTemplateModal] = useState(false);
const [currentTypeIndex, setCurrentTypeIndex] = useState(0);

// Add useEffect to check for unconfigured types when processing completes:
useEffect(() => {
  if (!isComplete || (counts.COMPARED ?? 0) + (counts.FLAGGED ?? 0) === 0) return;

  fetch(`/api/portals/${portalId}/scrape/${sessionId}/unconfigured-types`)
    .then((r) => r.json())
    .then((data) => {
      if (data.unconfiguredTypes?.length > 0) {
        setUnconfiguredTypes(data.unconfiguredTypes);
      }
    })
    .catch(() => {});
}, [isComplete, counts.COMPARED, counts.FLAGGED, portalId, sessionId]);
```

Add the banner and modal rendering after the progress bar:

```tsx
{unconfiguredTypes.length > 0 && !showTemplateModal && (
  <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/50 p-3">
    <p className="flex-1 text-sm text-muted-foreground">
      {unconfiguredTypes.length} claim type{unconfiguredTypes.length > 1 ? "s" : ""} used
      full comparison (no template). Configure templates for focused matching.
    </p>
    <Button size="sm" variant="outline" onClick={() => { setCurrentTypeIndex(0); setShowTemplateModal(true); }}>
      Configure
    </Button>
  </div>
)}

{showTemplateModal && unconfiguredTypes[currentTypeIndex] && (
  <ComparisonTemplateModal
    portalId={portalId}
    groupingKey={unconfiguredTypes[currentTypeIndex].groupingKey}
    suggestedName={Object.values(unconfiguredTypes[currentTypeIndex].groupingKey).join(" / ")}
    availableFields={mergeFieldOptions(
      unconfiguredTypes[currentTypeIndex].pageFields,
      unconfiguredTypes[currentTypeIndex].pdfFields
    )}
    onSaved={async (templateId) => {
      // Re-compare items with new template
      await fetch(`/api/portals/${portalId}/scrape/${sessionId}/recompare`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateId }),
      });
      // Move to next unconfigured type or close
      if (currentTypeIndex < unconfiguredTypes.length - 1) {
        setCurrentTypeIndex((i) => i + 1);
      } else {
        setShowTemplateModal(false);
        setUnconfiguredTypes([]);
        router.refresh();
      }
    }}
    onSkip={() => {
      if (currentTypeIndex < unconfiguredTypes.length - 1) {
        setCurrentTypeIndex((i) => i + 1);
      } else {
        setShowTemplateModal(false);
      }
    }}
  />
)}
```

Add the helper function in the component:

```typescript
function mergeFieldOptions(pageFields: string[], pdfFields: string[]) {
  const pageSet = new Set(pageFields);
  const pdfSet = new Set(pdfFields);
  const allNames = new Set([...pageFields, ...pdfFields]);

  return Array.from(allNames).map((name) => ({
    name,
    source: (pageSet.has(name) && pdfSet.has(name) ? "both" : pageSet.has(name) ? "page" : "pdf") as "page" | "pdf" | "both",
  }));
}
```

- [ ] **Step 2: Update SessionActionsProps to include portalId**

Ensure `portalId` is passed through from the server component if not already present (it is — check existing props interface).

- [ ] **Step 3: Commit**

```bash
git add src/components/portals/session-actions.tsx
git commit -m "feat: inline template config prompt"
```

---

### Task 12: Update Comparison Display — Show Template Info

**Files:**
- Modify: `src/components/portals/item-detail-view.tsx`
- Modify: `src/app/(dashboard)/portals/[id]/sessions/[sessionId]/items/[itemId]/page.tsx`

- [ ] **Step 1: Add templateId/templateName to the data flow**

In the item detail page server component, update the Prisma query to include `templateId` in the `comparisonResult` select:

```typescript
comparisonResult: {
  select: {
    id: true,
    provider: true,
    templateId: true,
    matchCount: true,
    mismatchCount: true,
    summary: true,
    fieldComparisons: true,
    completedAt: true,
  },
},
```

Update the `ComparisonData` interface in `item-detail-view.tsx`:

```typescript
interface ComparisonData {
  id: string;
  provider: string;
  matchCount: number;
  mismatchCount: number;
  summary: string | null;
  fields: ComparisonField[];
  createdAt: string;
  templateId: string | null;     // add
  templateName: string | null;   // add
}
```

- [ ] **Step 2: Show template badge in comparison header**

In the comparison summary card, add a template indicator next to the provider badge:

```tsx
<div className="flex items-center justify-between">
  <CardTitle className="text-base">Comparison Result</CardTitle>
  <div className="flex items-center gap-2">
    {comparison.templateName ? (
      <Badge variant="outline">{comparison.templateName}</Badge>
    ) : (
      <Badge variant="secondary" className="text-muted-foreground">Full comparison</Badge>
    )}
    <Badge variant="secondary">{comparison.provider}</Badge>
  </div>
</div>
```

- [ ] **Step 3: Pass template name from server to client**

In the item detail page, fetch the template name if `templateId` exists:

```typescript
let templateName: string | null = null;
if (comparison?.templateId) {
  const template = await db.comparisonTemplate.findUnique({
    where: { id: comparison.templateId },
    select: { name: true },
  });
  templateName = template?.name ?? null;
}
```

Pass it through in the comparison object:

```typescript
comparison: comparison
  ? {
      // ...existing fields...
      templateId: comparison.templateId,
      templateName,
    }
  : null,
```

- [ ] **Step 4: Commit**

```bash
git add src/components/portals/item-detail-view.tsx src/app/
git commit -m "feat: show template info in comparison"
```

---

### Task 13: Template Management in Portal Detail View

**Files:**
- Create: `src/components/portals/template-list.tsx`
- Modify: `src/components/portals/portal-detail-view.tsx`

- [ ] **Step 1: Create template list component**

Create `src/components/portals/template-list.tsx`:

```typescript
"use client";

import { useState, useEffect } from "react";
import { Trash2, Loader2, FileSliders } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MATCH_MODE_LABELS } from "@/types/portal";
import type { ComparisonTemplateSummary, MatchMode } from "@/types/portal";

interface TemplateListProps {
  portalId: string;
}

export function TemplateList({ portalId }: TemplateListProps) {
  const [templates, setTemplates] = useState<ComparisonTemplateSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/portals/${portalId}/templates`)
      .then((r) => r.json())
      .then((data) => setTemplates(data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [portalId]);

  async function handleDelete(templateId: string) {
    setDeleting(templateId);
    try {
      await fetch(`/api/portals/${portalId}/templates/${templateId}`, { method: "DELETE" });
      setTemplates((prev) => prev.filter((t) => t.id !== templateId));
    } finally {
      setDeleting(null);
    }
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <FileSliders className="h-4 w-4 text-muted-foreground" />
          <CardTitle className="text-base">Comparison Templates ({templates.length})</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        {templates.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No templates yet. Templates are created automatically when processing items with configured grouping fields.
          </p>
        ) : (
          <div className="space-y-3">
            {templates.map((t) => (
              <div key={t.id} className="rounded-lg border border-border p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-foreground">{t.name}</p>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDelete(t.id)}
                    disabled={deleting === t.id}
                    className="text-muted-foreground hover:text-status-error"
                  >
                    {deleting === t.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4" />
                    )}
                  </Button>
                </div>
                <div className="flex flex-wrap gap-1">
                  {Object.entries(t.groupingKey).map(([k, v]) => (
                    <Badge key={k} variant="secondary" className="text-xs">
                      {k}: {v}
                    </Badge>
                  ))}
                </div>
                <div className="flex flex-wrap gap-1">
                  {t.fields.map((f) => (
                    <span
                      key={f.fieldName}
                      className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground"
                    >
                      {f.fieldName}
                      <span className="text-muted-foreground/60">
                        ({MATCH_MODE_LABELS[f.mode as MatchMode]?.split(" ")[0] ?? f.mode})
                      </span>
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Add TemplateList to portal detail view**

In `src/components/portals/portal-detail-view.tsx`, import and render after `GroupingFieldConfig`:

```tsx
import { TemplateList } from "./template-list";

// In the settings/config area:
<TemplateList portalId={portal.id} />
```

- [ ] **Step 3: Commit**

```bash
git add src/components/portals/template-list.tsx src/components/portals/portal-detail-view.tsx
git commit -m "feat: template management UI"
```

---

### Task 14: Update PortalDetail Type + API to Include groupingFields

**Files:**
- Modify: `src/types/portal.ts`
- Modify portal detail API/page to pass `groupingFields`

- [ ] **Step 1: Add `groupingFields` to PortalDetail interface**

In `src/types/portal.ts`, update `PortalDetail`:

```typescript
export interface PortalDetail {
  // ...existing fields...
  groupingFields: string[];   // add
}
```

- [ ] **Step 2: Ensure portal detail page passes groupingFields**

In `src/app/(dashboard)/portals/[id]/page.tsx`, the portal query already includes all fields. Ensure the serialized data includes:

```typescript
groupingFields: (portal.groupingFields ?? []) as string[],
```

- [ ] **Step 3: Commit**

```bash
git add src/types/portal.ts src/app/
git commit -m "feat: include groupingFields in portal detail"
```

---

### Task 15: Type Check + Integration Verification

**Files:** None new — verification only.

- [ ] **Step 1: Run type check**

```bash
npx tsc --noEmit
```

Fix any type errors that arise from the new `templateId` field on `ComparisonResult`, the new `groupingFields` field on `Portal`, and the new `ComparisonTemplate` model.

- [ ] **Step 2: Run Prisma generate**

```bash
npx prisma generate
```

Verify the generated client includes `ComparisonTemplate` model and updated fields.

- [ ] **Step 3: Verify the full flow mentally**

1. User sets grouping fields on portal (e.g., "Claim Type") via `GroupingFieldConfig`
2. User starts a scrape — items process normally
3. Worker checks for matching template per item — none found (first run), uses full comparison (current behavior)
4. Session items page detects unconfigured types via `/unconfigured-types` API
5. Banner appears: "1 claim type has no template. Configure."
6. User clicks Configure → modal shows real field data → picks fields + rules → saves
7. System calls `/recompare` → deletes old results, re-runs comparison with template → refreshes
8. Next scrape: worker finds template → filters fields → uses templated prompt → focused comparison

- [ ] **Step 4: Commit any fixes**

```bash
git add .
git commit -m "fix: type check and integration fixes"
```
