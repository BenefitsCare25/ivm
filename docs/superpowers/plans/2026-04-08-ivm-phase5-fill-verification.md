# Phase 5: Fill Actions & Verification — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Execute target filling (PDF AcroForm, DOCX placeholder replacement, webpage fill script generation) from accepted field mappings, with verification and a review step for session completion.

**Architecture:** Three target-specific fillers dispatched by a central executor. PDF uses pdf-lib (already installed). DOCX uses JSZip (new dependency) for XML placeholder replacement. Webpage generates a JavaScript snippet (no browser automation). Fill + verify runs synchronously in one API call. Review step reads results and allows session completion.

**Tech Stack:** pdf-lib, JSZip (new), cheerio (existing), Prisma, Next.js App Router, Radix UI

---

## File Structure

### New Files (14)

| File | Responsibility |
|------|---------------|
| `src/lib/fill/types.ts` | Internal fill context and result types |
| `src/lib/fill/pdf-filler.ts` | Fill PDF AcroForm fields via pdf-lib |
| `src/lib/fill/docx-filler.ts` | Replace DOCX `{{placeholders}}` via JSZip |
| `src/lib/fill/webpage-filler.ts` | Generate JS fill script from CSS selectors |
| `src/lib/fill/index.ts` | Dispatcher + helper to build FillAction records |
| `src/lib/validations/fill.ts` | Zod schema for fill execution request |
| `src/app/api/sessions/[id]/fill/route.ts` | POST (execute fill) + GET (fetch results) |
| `src/app/api/sessions/[id]/fill/download/route.ts` | GET filled document (PDF/DOCX) |
| `src/app/api/sessions/[id]/complete/route.ts` | POST to mark session COMPLETED |
| `src/components/sessions/fill-step-client.tsx` | Fill step UI (execute, progress, download) |
| `src/components/sessions/fill-actions-table.tsx` | Reusable table for fill action rows |
| `src/components/sessions/fill-report-card.tsx` | Summary stats card (applied/verified/failed) |
| `src/components/sessions/review-step-client.tsx` | Review step UI (report, download, complete) |
| `src/components/sessions/webpage-fill-script.tsx` | Code block with copy button for JS snippet |

### Modified Files (5)

| File | Change |
|------|--------|
| `prisma/schema.prisma` | Add `filledStoragePath String?` to `TargetAsset` |
| `src/types/fill.ts` | Add `FillState`, `FillSessionData`, `WebpageFillScript` types |
| `src/app/(dashboard)/sessions/[id]/fill/page.tsx` | Replace placeholder with server component |
| `src/app/(dashboard)/sessions/[id]/review/page.tsx` | Replace placeholder with server component |
| `package.json` | Add `jszip` dependency |

---

## Task 1: Install JSZip + Prisma Migration

**Files:**
- Modify: `package.json` (add jszip)
- Modify: `prisma/schema.prisma:176-193` (add filledStoragePath to TargetAsset)
- Create: new migration file (auto-generated)

- [ ] **Step 1: Install JSZip**

```bash
npm install jszip
```

JSZip ships its own TypeScript definitions — no `@types/jszip` needed.

- [ ] **Step 2: Add `filledStoragePath` to TargetAsset model**

In `prisma/schema.prisma`, add one line to the `TargetAsset` model after `storagePath`:

```prisma
model TargetAsset {
  id                String     @id @default(cuid())
  fillSessionId     String
  targetType        TargetType
  url               String?
  fileName          String?
  storagePath       String?
  filledStoragePath String?
  detectedFields    Json       @default("[]")
  isSupported       Boolean    @default(true)
  unsupportedReason String?
  inspectedAt       DateTime?

  fillSession FillSession  @relation(fields: [fillSessionId], references: [id], onDelete: Cascade)
  mappingSets MappingSet[]

  @@index([fillSessionId])
  @@map("target_assets")
}
```

- [ ] **Step 3: Run migration**

```bash
npx prisma migrate dev --name add-filled-storage-path
```

Expected: Migration creates `ALTER TABLE target_assets ADD COLUMN "filledStoragePath" TEXT`.

- [ ] **Step 4: Regenerate Prisma client**

```bash
npx prisma generate
```

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json prisma/schema.prisma prisma/migrations/
git commit -m "feat: add jszip and filledStoragePath migration"
```

---

## Task 2: Extend Fill Types

**Files:**
- Modify: `src/types/fill.ts`

- [ ] **Step 1: Add types to `src/types/fill.ts`**

Replace the entire file with:

```typescript
export type FillActionStatus = "PENDING" | "APPLIED" | "VERIFIED" | "FAILED" | "SKIPPED";

export type FillState = "idle" | "processing" | "completed" | "failed";

export interface FillActionSummary {
  id: string;
  targetFieldId: string;
  targetLabel: string;
  intendedValue: string;
  appliedValue: string | null;
  verifiedValue: string | null;
  status: FillActionStatus;
  errorMessage: string | null;
}

export interface FillReport {
  total: number;
  applied: number;
  verified: number;
  failed: number;
  skipped: number;
}

export interface FillSessionData {
  actions: FillActionSummary[];
  report: FillReport;
  hasFilledDocument: boolean;
  webpageFillScript: string | null;
}

export interface WebpageFillScript {
  script: string;
  fieldCount: number;
  targetUrl: string;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/types/fill.ts
git commit -m "feat: extend fill types"
```

---

## Task 3: Internal Fill Types

**Files:**
- Create: `src/lib/fill/types.ts`

- [ ] **Step 1: Create `src/lib/fill/types.ts`**

```typescript
import type { TargetType, TargetField } from "@/types/target";
import type { FieldMapping } from "@/types/mapping";

export interface FillContext {
  sessionId: string;
  mappingSetId: string;
  targetType: TargetType;
  targetFields: TargetField[];
  approvedMappings: FieldMapping[];
  storagePath: string | null;
  targetUrl: string | null;
  targetFileName: string | null;
}

export interface FillFieldResult {
  targetFieldId: string;
  targetLabel: string;
  intendedValue: string;
  appliedValue: string | null;
  verifiedValue: string | null;
  status: "APPLIED" | "VERIFIED" | "FAILED" | "SKIPPED";
  errorMessage: string | null;
}

export interface FillerResult {
  results: FillFieldResult[];
  filledStoragePath: string | null;
  webpageFillScript: string | null;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/fill/types.ts
git commit -m "feat: add internal fill types"
```

---

## Task 4: Fill Validation Schema

**Files:**
- Create: `src/lib/validations/fill.ts`

- [ ] **Step 1: Create `src/lib/validations/fill.ts`**

```typescript
import { z } from "zod";

export const executeFillSchema = z.object({
  skipFieldIds: z.array(z.string()).optional(),
});

export type ExecuteFillInput = z.infer<typeof executeFillSchema>;
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/validations/fill.ts
git commit -m "feat: add fill validation schema"
```

---

## Task 5: PDF Filler

**Files:**
- Create: `src/lib/fill/pdf-filler.ts`

This is the most straightforward filler. pdf-lib can read and write AcroForm fields.

- [ ] **Step 1: Create `src/lib/fill/pdf-filler.ts`**

```typescript
import {
  PDFDocument,
  PDFTextField,
  PDFCheckBox,
  PDFDropdown,
  PDFRadioGroup,
  PDFOptionList,
} from "pdf-lib";
import { randomUUID } from "crypto";
import { getStorageAdapter } from "@/lib/storage";
import { logger } from "@/lib/logger";
import type { FillContext, FillFieldResult, FillerResult } from "./types";

const TRUTHY_VALUES = new Set(["true", "yes", "1", "checked", "on"]);

export async function fillPdf(ctx: FillContext): Promise<FillerResult> {
  if (!ctx.storagePath) {
    return {
      results: ctx.approvedMappings.map((m) => ({
        targetFieldId: m.targetFieldId,
        targetLabel: m.targetLabel,
        intendedValue: m.userOverrideValue ?? m.transformedValue,
        appliedValue: null,
        verifiedValue: null,
        status: "FAILED" as const,
        errorMessage: "No PDF file found in storage",
      })),
      filledStoragePath: null,
      webpageFillScript: null,
    };
  }

  const storage = getStorageAdapter();
  const originalBuffer = await storage.download(ctx.storagePath);
  const pdf = await PDFDocument.load(originalBuffer, { ignoreEncryption: true });
  const form = pdf.getForm();

  const results: FillFieldResult[] = [];

  for (const mapping of ctx.approvedMappings) {
    const value = mapping.userOverrideValue ?? mapping.transformedValue;
    const targetField = ctx.targetFields.find((f) => f.id === mapping.targetFieldId);
    const fieldName = targetField?.name ?? mapping.targetFieldId;
    const label = targetField?.label ?? mapping.targetLabel;

    try {
      const pdfField = form.getField(fieldName);

      if (pdfField instanceof PDFTextField) {
        pdfField.setText(value);
      } else if (pdfField instanceof PDFCheckBox) {
        if (TRUTHY_VALUES.has(value.toLowerCase())) {
          pdfField.check();
        } else {
          pdfField.uncheck();
        }
      } else if (pdfField instanceof PDFDropdown) {
        pdfField.select(value);
      } else if (pdfField instanceof PDFRadioGroup) {
        pdfField.select(value);
      } else if (pdfField instanceof PDFOptionList) {
        pdfField.select(value);
      } else {
        results.push({
          targetFieldId: mapping.targetFieldId,
          targetLabel: label,
          intendedValue: value,
          appliedValue: null,
          verifiedValue: null,
          status: "FAILED",
          errorMessage: `Unsupported PDF field type for "${fieldName}"`,
        });
        continue;
      }

      results.push({
        targetFieldId: mapping.targetFieldId,
        targetLabel: label,
        intendedValue: value,
        appliedValue: value,
        verifiedValue: null,
        status: "APPLIED",
        errorMessage: null,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      logger.warn({ fieldName, error: msg }, "PDF fill failed for field");
      results.push({
        targetFieldId: mapping.targetFieldId,
        targetLabel: label,
        intendedValue: value,
        appliedValue: null,
        verifiedValue: null,
        status: "FAILED",
        errorMessage: `Could not fill field "${fieldName}": ${msg}`,
      });
    }
  }

  // Save filled PDF
  const filledBytes = await pdf.save();
  const filledBuffer = Buffer.from(filledBytes);
  const filledKey = `filled/${ctx.sessionId}/${randomUUID()}.pdf`;
  await storage.upload(filledKey, filledBuffer, "application/pdf");

  // Verify by reloading
  const verifyPdf = await PDFDocument.load(filledBuffer, { ignoreEncryption: true });
  const verifyForm = verifyPdf.getForm();

  for (const result of results) {
    if (result.status !== "APPLIED") continue;

    const targetField = ctx.targetFields.find((f) => f.id === result.targetFieldId);
    const fieldName = targetField?.name ?? result.targetFieldId;

    try {
      const field = verifyForm.getField(fieldName);
      let readBack: string | null = null;

      if (field instanceof PDFTextField) {
        readBack = field.getText() ?? null;
      } else if (field instanceof PDFCheckBox) {
        readBack = field.isChecked() ? "true" : "false";
      } else if (field instanceof PDFDropdown || field instanceof PDFOptionList) {
        const selected = field.getSelected();
        readBack = selected.length > 0 ? selected[0] : null;
      } else if (field instanceof PDFRadioGroup) {
        readBack = field.getSelected() ?? null;
      }

      result.verifiedValue = readBack;
      result.status = "VERIFIED";
    } catch {
      result.verifiedValue = null;
      // Keep APPLIED status — verification is best-effort
    }
  }

  return {
    results,
    filledStoragePath: filledKey,
    webpageFillScript: null,
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/fill/pdf-filler.ts
git commit -m "feat: add PDF filler"
```

---

## Task 6: DOCX Filler

**Files:**
- Create: `src/lib/fill/docx-filler.ts`

DOCX files are ZIP archives. The main content is in `word/document.xml`. We find `{{placeholder}}` patterns in the XML text nodes and replace them.

- [ ] **Step 1: Create `src/lib/fill/docx-filler.ts`**

```typescript
import JSZip from "jszip";
import mammoth from "mammoth";
import { randomUUID } from "crypto";
import { getStorageAdapter } from "@/lib/storage";
import { logger } from "@/lib/logger";
import type { FillContext, FillFieldResult, FillerResult } from "./types";

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export async function fillDocx(ctx: FillContext): Promise<FillerResult> {
  if (!ctx.storagePath) {
    return {
      results: ctx.approvedMappings.map((m) => ({
        targetFieldId: m.targetFieldId,
        targetLabel: m.targetLabel,
        intendedValue: m.userOverrideValue ?? m.transformedValue,
        appliedValue: null,
        verifiedValue: null,
        status: "FAILED" as const,
        errorMessage: "No DOCX file found in storage",
      })),
      filledStoragePath: null,
      webpageFillScript: null,
    };
  }

  const storage = getStorageAdapter();
  const originalBuffer = await storage.download(ctx.storagePath);
  const zip = await JSZip.loadAsync(originalBuffer);

  const docXmlFile = zip.file("word/document.xml");
  if (!docXmlFile) {
    return {
      results: ctx.approvedMappings.map((m) => ({
        targetFieldId: m.targetFieldId,
        targetLabel: m.targetLabel,
        intendedValue: m.userOverrideValue ?? m.transformedValue,
        appliedValue: null,
        verifiedValue: null,
        status: "FAILED" as const,
        errorMessage: "DOCX has no word/document.xml",
      })),
      filledStoragePath: null,
      webpageFillScript: null,
    };
  }

  let docXml = await docXmlFile.async("string");
  const results: FillFieldResult[] = [];

  for (const mapping of ctx.approvedMappings) {
    const value = mapping.userOverrideValue ?? mapping.transformedValue;
    const targetField = ctx.targetFields.find((f) => f.id === mapping.targetFieldId);
    const placeholderName = targetField?.name ?? mapping.targetFieldId;
    const label = targetField?.label ?? mapping.targetLabel;
    const placeholder = `{{${placeholderName}}}`;

    if (docXml.includes(placeholder)) {
      docXml = docXml.split(placeholder).join(escapeXml(value));
      results.push({
        targetFieldId: mapping.targetFieldId,
        targetLabel: label,
        intendedValue: value,
        appliedValue: value,
        verifiedValue: null,
        status: "APPLIED",
        errorMessage: null,
      });
    } else {
      logger.warn({ placeholderName }, "DOCX placeholder not found as contiguous text");
      results.push({
        targetFieldId: mapping.targetFieldId,
        targetLabel: label,
        intendedValue: value,
        appliedValue: null,
        verifiedValue: null,
        status: "FAILED",
        errorMessage: `Placeholder "{{${placeholderName}}}" not found as contiguous text in document XML. It may be split across formatting runs.`,
      });
    }
  }

  // Save modified XML back to ZIP
  zip.file("word/document.xml", docXml);
  const filledBuffer = Buffer.from(
    await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" })
  );

  const filledKey = `filled/${ctx.sessionId}/${randomUUID()}.docx`;
  await storage.upload(
    filledKey,
    filledBuffer,
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  );

  // Verify by extracting text from filled DOCX
  try {
    const { value: filledText } = await mammoth.extractRawText({ buffer: filledBuffer });
    for (const result of results) {
      if (result.status !== "APPLIED") continue;
      const targetField = ctx.targetFields.find((f) => f.id === result.targetFieldId);
      const placeholderName = targetField?.name ?? result.targetFieldId;

      // Verify placeholder is gone and value is present
      if (!filledText.includes(`{{${placeholderName}}}`) && filledText.includes(result.intendedValue)) {
        result.verifiedValue = result.intendedValue;
        result.status = "VERIFIED";
      }
      // If can't verify, keep APPLIED — verification is best-effort
    }
  } catch (err) {
    logger.warn({ err }, "DOCX verification failed — keeping APPLIED status");
  }

  return {
    results,
    filledStoragePath: filledKey,
    webpageFillScript: null,
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/fill/docx-filler.ts
git commit -m "feat: add DOCX filler"
```

---

## Task 7: Webpage Filler (Script Generator)

**Files:**
- Create: `src/lib/fill/webpage-filler.ts`

No browser automation — generates a JavaScript snippet the user pastes into DevTools on the target page.

- [ ] **Step 1: Create `src/lib/fill/webpage-filler.ts`**

```typescript
import type { FillContext, FillFieldResult, FillerResult } from "./types";

export async function fillWebpage(ctx: FillContext): Promise<FillerResult> {
  const results: FillFieldResult[] = [];
  const scriptLines: string[] = [
    "// IVM Auto-Fill Script",
    `// Target: ${ctx.targetUrl ?? "unknown"}`,
    `// Generated: ${new Date().toISOString()}`,
    "// Paste this into your browser DevTools console on the target page.",
    "",
    "(function() {",
    "  const results = [];",
  ];

  for (const mapping of ctx.approvedMappings) {
    const value = mapping.userOverrideValue ?? mapping.transformedValue;
    const targetField = ctx.targetFields.find((f) => f.id === mapping.targetFieldId);
    const selector = targetField?.selector;
    const label = targetField?.label ?? mapping.targetLabel;
    const fieldType = targetField?.fieldType ?? "text";

    if (!selector) {
      results.push({
        targetFieldId: mapping.targetFieldId,
        targetLabel: label,
        intendedValue: value,
        appliedValue: null,
        verifiedValue: null,
        status: "FAILED",
        errorMessage: "No CSS selector available for this field",
      });
      continue;
    }

    const escapedValue = JSON.stringify(value);
    const escapedSelector = JSON.stringify(selector);
    const escapedLabel = JSON.stringify(label);

    if (fieldType === "checkbox") {
      const checked = ["true", "yes", "1", "checked", "on"].includes(value.toLowerCase());
      scriptLines.push(
        `  try {`,
        `    const el = document.querySelector(${escapedSelector});`,
        `    if (!el) throw new Error("Element not found");`,
        `    el.checked = ${checked};`,
        `    el.dispatchEvent(new Event("change", { bubbles: true }));`,
        `    results.push({ field: ${escapedLabel}, status: "OK" });`,
        `  } catch(e) { results.push({ field: ${escapedLabel}, status: "FAIL", error: e.message }); }`,
        ""
      );
    } else if (fieldType === "select") {
      scriptLines.push(
        `  try {`,
        `    const el = document.querySelector(${escapedSelector});`,
        `    if (!el) throw new Error("Element not found");`,
        `    el.value = ${escapedValue};`,
        `    el.dispatchEvent(new Event("change", { bubbles: true }));`,
        `    results.push({ field: ${escapedLabel}, status: "OK" });`,
        `  } catch(e) { results.push({ field: ${escapedLabel}, status: "FAIL", error: e.message }); }`,
        ""
      );
    } else {
      // text, textarea, email, number, date, etc.
      scriptLines.push(
        `  try {`,
        `    const el = document.querySelector(${escapedSelector});`,
        `    if (!el) throw new Error("Element not found");`,
        `    const nativeSetter = Object.getOwnPropertyDescriptor(`,
        `      window.HTMLInputElement.prototype, "value"`,
        `    )?.set || Object.getOwnPropertyDescriptor(`,
        `      window.HTMLTextAreaElement.prototype, "value"`,
        `    )?.set;`,
        `    if (nativeSetter) nativeSetter.call(el, ${escapedValue});`,
        `    else el.value = ${escapedValue};`,
        `    el.dispatchEvent(new Event("input", { bubbles: true }));`,
        `    el.dispatchEvent(new Event("change", { bubbles: true }));`,
        `    results.push({ field: ${escapedLabel}, status: "OK" });`,
        `  } catch(e) { results.push({ field: ${escapedLabel}, status: "FAIL", error: e.message }); }`,
        ""
      );
    }

    // All webpage fills are marked APPLIED (no server-side verification possible)
    results.push({
      targetFieldId: mapping.targetFieldId,
      targetLabel: label,
      intendedValue: value,
      appliedValue: value,
      verifiedValue: null,
      status: "APPLIED",
      errorMessage: null,
    });
  }

  scriptLines.push(
    `  console.table(results);`,
    `  const ok = results.filter(r => r.status === "OK").length;`,
    `  console.log("IVM Fill: " + ok + "/" + results.length + " fields filled.");`,
    "})();"
  );

  return {
    results,
    filledStoragePath: null,
    webpageFillScript: scriptLines.join("\n"),
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/fill/webpage-filler.ts
git commit -m "feat: add webpage filler script generator"
```

---

## Task 8: Fill Dispatcher

**Files:**
- Create: `src/lib/fill/index.ts`

- [ ] **Step 1: Create `src/lib/fill/index.ts`**

```typescript
import type { FieldMapping } from "@/types/mapping";
import type { TargetField, TargetType } from "@/types/target";
import type { FillContext, FillerResult } from "./types";
import { fillPdf } from "./pdf-filler";
import { fillDocx } from "./docx-filler";
import { fillWebpage } from "./webpage-filler";

export function buildFillContext(params: {
  sessionId: string;
  mappingSetId: string;
  targetType: TargetType;
  targetFields: TargetField[];
  mappings: FieldMapping[];
  storagePath: string | null;
  targetUrl: string | null;
  targetFileName: string | null;
  skipFieldIds?: string[];
}): FillContext {
  const approved = params.mappings.filter((m) => {
    if (!m.userApproved) return false;
    if (m.sourceFieldId === null && !m.userOverrideValue) return false;
    if (params.skipFieldIds?.includes(m.targetFieldId)) return false;
    return true;
  });

  return {
    sessionId: params.sessionId,
    mappingSetId: params.mappingSetId,
    targetType: params.targetType,
    targetFields: params.targetFields,
    approvedMappings: approved,
    storagePath: params.storagePath,
    targetUrl: params.targetUrl,
    targetFileName: params.targetFileName,
  };
}

export async function executeFill(ctx: FillContext): Promise<FillerResult> {
  switch (ctx.targetType) {
    case "PDF":
      return fillPdf(ctx);
    case "DOCX":
      return fillDocx(ctx);
    case "WEBPAGE":
      return fillWebpage(ctx);
    default:
      throw new Error(`Unsupported target type: ${ctx.targetType}`);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/fill/index.ts
git commit -m "feat: add fill dispatcher"
```

---

## Task 9: Fill API Route (POST + GET)

**Files:**
- Create: `src/app/api/sessions/[id]/fill/route.ts`

This is the core API. POST creates FillAction records, executes fills, and updates session status. GET returns existing fill results.

- [ ] **Step 1: Create `src/app/api/sessions/[id]/fill/route.ts`**

```typescript
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import {
  errorResponse,
  UnauthorizedError,
  NotFoundError,
  ValidationError,
  AppError,
} from "@/lib/errors";
import { executeFillSchema } from "@/lib/validations/fill";
import { buildFillContext, executeFill } from "@/lib/fill";
import type { FieldMapping } from "@/types/mapping";
import type { TargetField, TargetType } from "@/types/target";
import type { FillActionSummary, FillReport } from "@/types/fill";

function buildReport(actions: FillActionSummary[]): FillReport {
  return {
    total: actions.length,
    applied: actions.filter((a) => a.status === "APPLIED").length,
    verified: actions.filter((a) => a.status === "VERIFIED").length,
    failed: actions.filter((a) => a.status === "FAILED").length,
    skipped: actions.filter((a) => a.status === "SKIPPED").length,
  };
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) throw new UnauthorizedError();

    const { id } = await params;

    const body = await req.json().catch(() => ({}));
    const parsed = executeFillSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError("Invalid fill request", {
        fill: parsed.error.issues.map((e) => e.message),
      });
    }

    const fillSession = await db.fillSession.findFirst({
      where: { id, userId: session.user.id },
      include: {
        targetAssets: { orderBy: { inspectedAt: "desc" }, take: 1 },
        mappingSets: {
          where: { status: "ACCEPTED" },
          orderBy: { reviewedAt: "desc" },
          take: 1,
        },
      },
    });
    if (!fillSession) throw new NotFoundError("Session", id);

    const mappingSet = fillSession.mappingSets[0];
    if (!mappingSet) {
      throw new ValidationError("No accepted mapping set. Accept mappings first.");
    }

    const targetAsset = fillSession.targetAssets[0];
    if (!targetAsset) {
      throw new ValidationError("No target asset found.");
    }

    const mappings = mappingSet.mappings as unknown as FieldMapping[];
    const targetFields = targetAsset.detectedFields as unknown as TargetField[];

    // Delete existing fill actions (re-fill support)
    await db.fillAction.deleteMany({ where: { fillSessionId: id } });

    const ctx = buildFillContext({
      sessionId: id,
      mappingSetId: mappingSet.id,
      targetType: targetAsset.targetType as TargetType,
      targetFields,
      mappings,
      storagePath: targetAsset.storagePath,
      targetUrl: targetAsset.url,
      targetFileName: targetAsset.fileName,
      skipFieldIds: parsed.data.skipFieldIds,
    });

    if (ctx.approvedMappings.length === 0) {
      throw new ValidationError("No approved mappings to fill. Approve at least one mapping.");
    }

    const result = await executeFill(ctx);

    // Create FillAction records
    const now = new Date();
    const fillActions = await Promise.all(
      result.results.map((r) =>
        db.fillAction.create({
          data: {
            fillSessionId: id,
            mappingSetId: mappingSet.id,
            targetFieldId: r.targetFieldId,
            intendedValue: r.intendedValue,
            appliedValue: r.appliedValue,
            verifiedValue: r.verifiedValue,
            status: r.status,
            errorMessage: r.errorMessage,
            appliedAt: r.status !== "FAILED" && r.status !== "SKIPPED" ? now : null,
            verifiedAt: r.status === "VERIFIED" ? now : null,
          },
        })
      )
    );

    // Update target asset with filled storage path
    if (result.filledStoragePath) {
      await db.targetAsset.update({
        where: { id: targetAsset.id },
        data: { filledStoragePath: result.filledStoragePath },
      });
    }

    // Update session status
    await db.fillSession.updateMany({
      where: { id, userId: session.user.id },
      data: { status: "FILLED", currentStep: "FILL" },
    });

    // Audit event
    const actions: FillActionSummary[] = fillActions.map((fa, i) => ({
      id: fa.id,
      targetFieldId: fa.targetFieldId,
      targetLabel: result.results[i].targetLabel,
      intendedValue: fa.intendedValue,
      appliedValue: fa.appliedValue,
      verifiedValue: fa.verifiedValue,
      status: fa.status as FillActionSummary["status"],
      errorMessage: fa.errorMessage,
    }));

    const report = buildReport(actions);

    await db.auditEvent.create({
      data: {
        fillSessionId: id,
        eventType: "FILL_EXECUTED",
        actor: session.user.id,
        payload: JSON.parse(JSON.stringify({
          targetType: targetAsset.targetType,
          report,
        })),
      },
    });

    logger.info(
      { sessionId: id, targetType: targetAsset.targetType, report },
      "Fill executed"
    );

    return NextResponse.json({
      actions,
      report,
      hasFilledDocument: result.filledStoragePath !== null,
      webpageFillScript: result.webpageFillScript,
    });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) throw new UnauthorizedError();

    const { id } = await params;

    const fillSession = await db.fillSession.findFirst({
      where: { id, userId: session.user.id },
      include: {
        targetAssets: { orderBy: { inspectedAt: "desc" }, take: 1 },
        fillActions: true,
        mappingSets: {
          where: { status: "ACCEPTED" },
          orderBy: { reviewedAt: "desc" },
          take: 1,
        },
      },
    });
    if (!fillSession) throw new NotFoundError("Session", id);

    if (fillSession.fillActions.length === 0) {
      return NextResponse.json(null);
    }

    const targetAsset = fillSession.targetAssets[0];
    const mappingSet = fillSession.mappingSets[0];
    const mappings = mappingSet
      ? (mappingSet.mappings as unknown as FieldMapping[])
      : [];
    const targetFields = targetAsset
      ? (targetAsset.detectedFields as unknown as TargetField[])
      : [];

    const actions: FillActionSummary[] = fillSession.fillActions.map((fa) => {
      const targetField = targetFields.find((f) => f.id === fa.targetFieldId);
      const mapping = mappings.find((m) => m.targetFieldId === fa.targetFieldId);
      return {
        id: fa.id,
        targetFieldId: fa.targetFieldId,
        targetLabel: targetField?.label ?? mapping?.targetLabel ?? fa.targetFieldId,
        intendedValue: fa.intendedValue,
        appliedValue: fa.appliedValue,
        verifiedValue: fa.verifiedValue,
        status: fa.status as FillActionSummary["status"],
        errorMessage: fa.errorMessage,
      };
    });

    const report = buildReport(actions);

    return NextResponse.json({
      actions,
      report,
      hasFilledDocument: targetAsset?.filledStoragePath !== null && targetAsset?.filledStoragePath !== undefined,
      webpageFillScript: null, // Script is not persisted — only returned on POST
    });
  } catch (err) {
    return errorResponse(err);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/sessions/[id]/fill/route.ts
git commit -m "feat: add fill API route"
```

---

## Task 10: Download API Route

**Files:**
- Create: `src/app/api/sessions/[id]/fill/download/route.ts`

Streams the filled PDF or DOCX from storage.

- [ ] **Step 1: Create `src/app/api/sessions/[id]/fill/download/route.ts`**

```typescript
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getStorageAdapter } from "@/lib/storage";
import { errorResponse, UnauthorizedError, NotFoundError, ValidationError } from "@/lib/errors";

const CONTENT_TYPES: Record<string, string> = {
  PDF: "application/pdf",
  DOCX: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

const EXTENSIONS: Record<string, string> = {
  PDF: ".pdf",
  DOCX: ".docx",
};

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) throw new UnauthorizedError();

    const { id } = await params;

    const fillSession = await db.fillSession.findFirst({
      where: { id, userId: session.user.id },
      include: {
        targetAssets: { orderBy: { inspectedAt: "desc" }, take: 1 },
      },
    });
    if (!fillSession) throw new NotFoundError("Session", id);

    const targetAsset = fillSession.targetAssets[0];
    if (!targetAsset) throw new NotFoundError("Target asset");
    if (!targetAsset.filledStoragePath) {
      throw new ValidationError("No filled document available. Execute fill first.");
    }

    if (targetAsset.targetType === "WEBPAGE") {
      throw new ValidationError("Webpage targets don't produce downloadable files.");
    }

    const storage = getStorageAdapter();
    const buffer = await storage.download(targetAsset.filledStoragePath);

    const ext = EXTENSIONS[targetAsset.targetType] ?? "";
    const baseName = targetAsset.fileName
      ? targetAsset.fileName.replace(/\.[^.]+$/, "")
      : "document";
    const fileName = `${baseName}-filled${ext}`;

    return new Response(buffer, {
      headers: {
        "Content-Type": CONTENT_TYPES[targetAsset.targetType] ?? "application/octet-stream",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Content-Length": String(buffer.length),
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/sessions/[id]/fill/download/route.ts
git commit -m "feat: add fill download route"
```

---

## Task 11: Session Complete API Route

**Files:**
- Create: `src/app/api/sessions/[id]/complete/route.ts`

- [ ] **Step 1: Create `src/app/api/sessions/[id]/complete/route.ts`**

```typescript
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { errorResponse, UnauthorizedError, NotFoundError, ValidationError } from "@/lib/errors";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) throw new UnauthorizedError();

    const { id } = await params;

    const fillSession = await db.fillSession.findFirst({
      where: { id, userId: session.user.id },
    });
    if (!fillSession) throw new NotFoundError("Session", id);

    if (fillSession.status !== "FILLED") {
      throw new ValidationError("Session must be in FILLED status to complete.");
    }

    await Promise.all([
      db.fillSession.updateMany({
        where: { id, userId: session.user.id },
        data: { status: "COMPLETED", currentStep: "REVIEW" },
      }),
      db.auditEvent.create({
        data: {
          fillSessionId: id,
          eventType: "SESSION_COMPLETED",
          actor: session.user.id,
        },
      }),
    ]);

    logger.info({ sessionId: id }, "Session completed");

    return NextResponse.json({ status: "COMPLETED" });
  } catch (err) {
    return errorResponse(err);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/sessions/[id]/complete/route.ts
git commit -m "feat: add session complete route"
```

---

## Task 12: Fill Report Card Component

**Files:**
- Create: `src/components/sessions/fill-report-card.tsx`

- [ ] **Step 1: Create `src/components/sessions/fill-report-card.tsx`**

```tsx
import { Card, CardContent } from "@/components/ui/card";
import type { FillReport } from "@/types/fill";

interface FillReportCardProps {
  report: FillReport;
}

export function FillReportCard({ report }: FillReportCardProps) {
  const stats = [
    { label: "Total", value: report.total, className: "text-foreground" },
    { label: "Verified", value: report.verified, className: "text-emerald-500" },
    { label: "Applied", value: report.applied, className: "text-sky-500" },
    { label: "Failed", value: report.failed, className: "text-red-500" },
    { label: "Skipped", value: report.skipped, className: "text-muted-foreground" },
  ];

  return (
    <Card>
      <CardContent className="py-4">
        <div className="grid grid-cols-5 gap-4 text-center">
          {stats.map((stat) => (
            <div key={stat.label}>
              <p className={`text-2xl font-semibold ${stat.className}`}>
                {stat.value}
              </p>
              <p className="text-xs text-muted-foreground">{stat.label}</p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/sessions/fill-report-card.tsx
git commit -m "feat: add fill report card"
```

---

## Task 13: Fill Actions Table Component

**Files:**
- Create: `src/components/sessions/fill-actions-table.tsx`

- [ ] **Step 1: Create `src/components/sessions/fill-actions-table.tsx`**

```tsx
import { Badge } from "@/components/ui/badge";
import type { FillActionSummary, FillActionStatus } from "@/types/fill";

interface FillActionsTableProps {
  actions: FillActionSummary[];
}

const STATUS_VARIANT: Record<FillActionStatus, "success" | "warning" | "error" | "secondary" | "info"> = {
  VERIFIED: "success",
  APPLIED: "info",
  PENDING: "secondary",
  FAILED: "error",
  SKIPPED: "warning",
};

const STATUS_LABEL: Record<FillActionStatus, string> = {
  VERIFIED: "Verified",
  APPLIED: "Applied",
  PENDING: "Pending",
  FAILED: "Failed",
  SKIPPED: "Skipped",
};

export function FillActionsTable({ actions }: FillActionsTableProps) {
  if (actions.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No fill actions to display.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/30">
            <th className="px-4 py-2 text-left font-medium text-muted-foreground">
              Target Field
            </th>
            <th className="px-4 py-2 text-left font-medium text-muted-foreground">
              Intended Value
            </th>
            <th className="px-4 py-2 text-left font-medium text-muted-foreground">
              Applied Value
            </th>
            <th className="px-4 py-2 text-left font-medium text-muted-foreground">
              Status
            </th>
          </tr>
        </thead>
        <tbody>
          {actions.map((action) => (
            <tr key={action.id} className="border-b border-border last:border-0">
              <td className="px-4 py-2 font-medium text-foreground">
                {action.targetLabel}
              </td>
              <td className="px-4 py-2 text-muted-foreground">
                <span className="max-w-[200px] truncate inline-block" title={action.intendedValue}>
                  {action.intendedValue}
                </span>
              </td>
              <td className="px-4 py-2 text-muted-foreground">
                {action.status === "VERIFIED" ? (
                  <span className="text-emerald-500" title={action.verifiedValue ?? undefined}>
                    {action.verifiedValue ?? "—"}
                  </span>
                ) : action.appliedValue ? (
                  <span title={action.appliedValue}>{action.appliedValue}</span>
                ) : (
                  <span className="text-muted-foreground/50">—</span>
                )}
              </td>
              <td className="px-4 py-2">
                <Badge variant={STATUS_VARIANT[action.status]}>
                  {STATUS_LABEL[action.status]}
                </Badge>
                {action.errorMessage && (
                  <p className="mt-1 text-xs text-red-500">{action.errorMessage}</p>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/sessions/fill-actions-table.tsx
git commit -m "feat: add fill actions table"
```

---

## Task 14: Webpage Fill Script Component

**Files:**
- Create: `src/components/sessions/webpage-fill-script.tsx`

- [ ] **Step 1: Create `src/components/sessions/webpage-fill-script.tsx`**

```tsx
"use client";

import { useState } from "react";
import { Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

interface WebpageFillScriptProps {
  script: string;
  targetUrl: string | null;
}

export function WebpageFillScript({ script, targetUrl }: WebpageFillScriptProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(script);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium">Fill Script</CardTitle>
          <Button variant="outline" size="sm" onClick={handleCopy}>
            {copied ? (
              <>
                <Check className="mr-2 h-3 w-3" />
                Copied
              </>
            ) : (
              <>
                <Copy className="mr-2 h-3 w-3" />
                Copy Script
              </>
            )}
          </Button>
        </div>
        {targetUrl && (
          <p className="text-xs text-muted-foreground">
            Open{" "}
            <span className="font-mono text-foreground/80">{targetUrl}</span>
            {" "}in your browser, then paste this script into the DevTools console (F12).
          </p>
        )}
      </CardHeader>
      <CardContent>
        <pre className="max-h-[300px] overflow-auto rounded-md bg-muted p-3 text-xs font-mono text-muted-foreground">
          {script}
        </pre>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/sessions/webpage-fill-script.tsx
git commit -m "feat: add webpage fill script component"
```

---

## Task 15: Fill Step Client Component

**Files:**
- Create: `src/components/sessions/fill-step-client.tsx`

- [ ] **Step 1: Create `src/components/sessions/fill-step-client.tsx`**

```tsx
"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Play, ArrowRight, Download, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/form-error";
import { FillReportCard } from "./fill-report-card";
import { FillActionsTable } from "./fill-actions-table";
import { WebpageFillScript } from "./webpage-fill-script";
import type { FillState, FillSessionData } from "@/types/fill";
import type { TargetType } from "@/types/target";

interface FillStepClientProps {
  sessionId: string;
  hasPrerequisites: boolean;
  targetType: TargetType | null;
  targetUrl: string | null;
  initialData: FillSessionData | null;
}

function resolveInitialState(data: FillSessionData | null): FillState {
  if (!data) return "idle";
  if (data.actions.length > 0) return "completed";
  return "idle";
}

export function FillStepClient({
  sessionId,
  hasPrerequisites,
  targetType,
  targetUrl,
  initialData,
}: FillStepClientProps) {
  const router = useRouter();

  const [fillState, setFillState] = useState<FillState>(
    () => resolveInitialState(initialData)
  );
  const [fillData, setFillData] = useState<FillSessionData | null>(initialData);
  const [error, setError] = useState("");
  const [webpageScript, setWebpageScript] = useState<string | null>(
    initialData?.webpageFillScript ?? null
  );

  const handleExecute = useCallback(async () => {
    setFillState("processing");
    setError("");

    try {
      const res = await fetch(`/api/sessions/${sessionId}/fill`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Fill execution failed");
      }

      const result = await res.json();
      setFillData(result);
      setWebpageScript(result.webpageFillScript);
      setFillState("completed");
      router.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Fill execution failed";
      setError(message);
      setFillState("failed");
    }
  }, [sessionId, router]);

  const handleDownload = useCallback(async () => {
    const res = await fetch(`/api/sessions/${sessionId}/fill/download`);
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = res.headers.get("Content-Disposition")?.split("filename=")[1]?.replace(/"/g, "") ?? "filled-document";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }, [sessionId]);

  if (!hasPrerequisites) {
    return (
      <div className="rounded-lg border border-border bg-muted/30 p-8 text-center">
        <p className="text-sm text-muted-foreground">
          Accept field mappings first before executing fill.
        </p>
        <div className="mt-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => router.push(`/sessions/${sessionId}/map`)}
          >
            Go to Mapping
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          {(fillState === "idle" || fillState === "failed") && (
            <span>
              Ready to fill {targetType?.toLowerCase()} target
            </span>
          )}
          {fillState === "processing" && (
            <span className="flex items-center gap-2">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              Executing fill...
            </span>
          )}
          {fillState === "completed" && fillData && (
            <span>
              Fill complete: {fillData.report.verified + fillData.report.applied} of{" "}
              {fillData.report.total} fields filled
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {(fillState === "idle" || fillState === "failed") && (
            <Button onClick={handleExecute}>
              <Play className="mr-2 h-4 w-4" />
              {fillState === "failed" ? "Retry Fill" : "Execute Fill"}
            </Button>
          )}
          {fillState === "completed" && (
            <>
              <Button variant="outline" size="sm" onClick={handleExecute}>
                <RotateCcw className="mr-2 h-4 w-4" />
                Re-fill
              </Button>
              {fillData?.hasFilledDocument && (
                <Button variant="outline" size="sm" onClick={handleDownload}>
                  <Download className="mr-2 h-4 w-4" />
                  Download
                </Button>
              )}
              <Button onClick={() => { router.push(`/sessions/${sessionId}/review`); router.refresh(); }}>
                Continue to Review
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </>
          )}
        </div>
      </div>

      <FormError message={error} />

      {fillState === "completed" && fillData && (
        <>
          <FillReportCard report={fillData.report} />
          {webpageScript && targetType === "WEBPAGE" && (
            <WebpageFillScript script={webpageScript} targetUrl={targetUrl} />
          )}
          <FillActionsTable actions={fillData.actions} />
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/sessions/fill-step-client.tsx
git commit -m "feat: add fill step client"
```

---

## Task 16: Fill Step Server Page

**Files:**
- Modify: `src/app/(dashboard)/sessions/[id]/fill/page.tsx`

- [ ] **Step 1: Replace fill page with server component**

Replace `src/app/(dashboard)/sessions/[id]/fill/page.tsx` entirely:

```tsx
export const dynamic = "force-dynamic";

import { requireAuth } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { notFound } from "next/navigation";
import { FillStepClient } from "@/components/sessions/fill-step-client";
import type { FieldMapping } from "@/types/mapping";
import type { TargetField, TargetType } from "@/types/target";
import type { FillActionSummary, FillReport, FillSessionData } from "@/types/fill";

function buildReport(actions: FillActionSummary[]): FillReport {
  return {
    total: actions.length,
    applied: actions.filter((a) => a.status === "APPLIED").length,
    verified: actions.filter((a) => a.status === "VERIFIED").length,
    failed: actions.filter((a) => a.status === "FAILED").length,
    skipped: actions.filter((a) => a.status === "SKIPPED").length,
  };
}

export default async function FillStepPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireAuth();
  const { id } = await params;

  const fillSession = await db.fillSession.findFirst({
    where: { id, userId: session.user.id },
    include: {
      targetAssets: { orderBy: { inspectedAt: "desc" }, take: 1 },
      mappingSets: {
        where: { status: "ACCEPTED" },
        orderBy: { reviewedAt: "desc" },
        take: 1,
      },
      fillActions: true,
    },
  });

  if (!fillSession) notFound();

  const targetAsset = fillSession.targetAssets[0];
  const mappingSet = fillSession.mappingSets[0];
  const hasPrerequisites = !!mappingSet;

  let initialData: FillSessionData | null = null;

  if (fillSession.fillActions.length > 0) {
    const mappings = mappingSet
      ? (mappingSet.mappings as unknown as FieldMapping[])
      : [];
    const targetFields = targetAsset
      ? (targetAsset.detectedFields as unknown as TargetField[])
      : [];

    const actions: FillActionSummary[] = fillSession.fillActions.map((fa) => {
      const tf = targetFields.find((f) => f.id === fa.targetFieldId);
      const mapping = mappings.find((m) => m.targetFieldId === fa.targetFieldId);
      return {
        id: fa.id,
        targetFieldId: fa.targetFieldId,
        targetLabel: tf?.label ?? mapping?.targetLabel ?? fa.targetFieldId,
        intendedValue: fa.intendedValue,
        appliedValue: fa.appliedValue,
        verifiedValue: fa.verifiedValue,
        status: fa.status as FillActionSummary["status"],
        errorMessage: fa.errorMessage,
      };
    });

    initialData = {
      actions,
      report: buildReport(actions),
      hasFilledDocument: !!targetAsset?.filledStoragePath,
      webpageFillScript: null,
    };
  }

  return (
    <FillStepClient
      sessionId={id}
      hasPrerequisites={hasPrerequisites}
      targetType={(targetAsset?.targetType as TargetType) ?? null}
      targetUrl={targetAsset?.url ?? null}
      initialData={initialData}
    />
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/(dashboard)/sessions/[id]/fill/page.tsx
git commit -m "feat: add fill step server page"
```

---

## Task 17: Review Step Client Component

**Files:**
- Create: `src/components/sessions/review-step-client.tsx`

- [ ] **Step 1: Create `src/components/sessions/review-step-client.tsx`**

```tsx
"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/form-error";
import { FillReportCard } from "./fill-report-card";
import { FillActionsTable } from "./fill-actions-table";
import type { FillSessionData } from "@/types/fill";
import type { TargetType } from "@/types/target";

interface ReviewStepClientProps {
  sessionId: string;
  hasPrerequisites: boolean;
  targetType: TargetType | null;
  sessionStatus: string;
  fillData: FillSessionData | null;
}

export function ReviewStepClient({
  sessionId,
  hasPrerequisites,
  targetType,
  sessionStatus,
  fillData,
}: ReviewStepClientProps) {
  const router = useRouter();
  const [completing, setCompleting] = useState(false);
  const [completed, setCompleted] = useState(sessionStatus === "COMPLETED");
  const [error, setError] = useState("");

  const handleComplete = useCallback(async () => {
    setCompleting(true);
    setError("");

    try {
      const res = await fetch(`/api/sessions/${sessionId}/complete`, {
        method: "POST",
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to complete session");
      }

      setCompleted(true);
      router.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to complete session";
      setError(message);
    } finally {
      setCompleting(false);
    }
  }, [sessionId, router]);

  const handleDownload = useCallback(async () => {
    const res = await fetch(`/api/sessions/${sessionId}/fill/download`);
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = res.headers.get("Content-Disposition")?.split("filename=")[1]?.replace(/"/g, "") ?? "filled-document";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }, [sessionId]);

  if (!hasPrerequisites || !fillData) {
    return (
      <div className="rounded-lg border border-border bg-muted/30 p-8 text-center">
        <p className="text-sm text-muted-foreground">
          Complete the fill step first before reviewing.
        </p>
        <div className="mt-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => router.push(`/sessions/${sessionId}/fill`)}
          >
            Go to Fill
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {completed && (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4 text-center">
          <CheckCircle className="mx-auto mb-2 h-8 w-8 text-emerald-500" />
          <p className="text-sm font-medium text-foreground">Session Completed</p>
          <p className="text-xs text-muted-foreground">
            All fill actions have been reviewed and the session is finalized.
          </p>
        </div>
      )}

      <FillReportCard report={fillData.report} />

      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Review all fill actions below before completing the session.
        </p>
        <div className="flex items-center gap-2">
          {fillData.hasFilledDocument && targetType !== "WEBPAGE" && (
            <Button variant="outline" size="sm" onClick={handleDownload}>
              <Download className="mr-2 h-4 w-4" />
              Download Filled Document
            </Button>
          )}
          {!completed && (
            <Button onClick={handleComplete} disabled={completing}>
              <CheckCircle className="mr-2 h-4 w-4" />
              {completing ? "Completing..." : "Complete Session"}
            </Button>
          )}
        </div>
      </div>

      <FormError message={error} />

      <FillActionsTable actions={fillData.actions} />
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/sessions/review-step-client.tsx
git commit -m "feat: add review step client"
```

---

## Task 18: Review Step Server Page

**Files:**
- Modify: `src/app/(dashboard)/sessions/[id]/review/page.tsx`

- [ ] **Step 1: Replace review page with server component**

Replace `src/app/(dashboard)/sessions/[id]/review/page.tsx` entirely:

```tsx
export const dynamic = "force-dynamic";

import { requireAuth } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { notFound } from "next/navigation";
import { ReviewStepClient } from "@/components/sessions/review-step-client";
import type { FieldMapping } from "@/types/mapping";
import type { TargetField, TargetType } from "@/types/target";
import type { FillActionSummary, FillReport, FillSessionData } from "@/types/fill";

function buildReport(actions: FillActionSummary[]): FillReport {
  return {
    total: actions.length,
    applied: actions.filter((a) => a.status === "APPLIED").length,
    verified: actions.filter((a) => a.status === "VERIFIED").length,
    failed: actions.filter((a) => a.status === "FAILED").length,
    skipped: actions.filter((a) => a.status === "SKIPPED").length,
  };
}

export default async function ReviewStepPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireAuth();
  const { id } = await params;

  const fillSession = await db.fillSession.findFirst({
    where: { id, userId: session.user.id },
    include: {
      targetAssets: { orderBy: { inspectedAt: "desc" }, take: 1 },
      mappingSets: {
        where: { status: "ACCEPTED" },
        orderBy: { reviewedAt: "desc" },
        take: 1,
      },
      fillActions: true,
    },
  });

  if (!fillSession) notFound();

  const targetAsset = fillSession.targetAssets[0];
  const mappingSet = fillSession.mappingSets[0];
  const hasFillActions = fillSession.fillActions.length > 0;

  let fillData: FillSessionData | null = null;

  if (hasFillActions) {
    const mappings = mappingSet
      ? (mappingSet.mappings as unknown as FieldMapping[])
      : [];
    const targetFields = targetAsset
      ? (targetAsset.detectedFields as unknown as TargetField[])
      : [];

    const actions: FillActionSummary[] = fillSession.fillActions.map((fa) => {
      const tf = targetFields.find((f) => f.id === fa.targetFieldId);
      const mapping = mappings.find((m) => m.targetFieldId === fa.targetFieldId);
      return {
        id: fa.id,
        targetFieldId: fa.targetFieldId,
        targetLabel: tf?.label ?? mapping?.targetLabel ?? fa.targetFieldId,
        intendedValue: fa.intendedValue,
        appliedValue: fa.appliedValue,
        verifiedValue: fa.verifiedValue,
        status: fa.status as FillActionSummary["status"],
        errorMessage: fa.errorMessage,
      };
    });

    fillData = {
      actions,
      report: buildReport(actions),
      hasFilledDocument: !!targetAsset?.filledStoragePath,
      webpageFillScript: null,
    };
  }

  return (
    <ReviewStepClient
      sessionId={id}
      hasPrerequisites={hasFillActions}
      targetType={(targetAsset?.targetType as TargetType) ?? null}
      sessionStatus={fillSession.status}
      fillData={fillData}
    />
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/(dashboard)/sessions/[id]/review/page.tsx
git commit -m "feat: add review step server page"
```

---

## Task 19: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update Phase Status table**

Change Phase 5 status from `Not started` to `Deployed` (after verification).

- [ ] **Step 2: Add Phase 5 architecture documentation**

Add to the "Architecture Patterns" section:

```markdown
### Fill Execution
- Three fillers in `src/lib/fill/`: `pdf-filler.ts` (pdf-lib AcroForm), `docx-filler.ts` (JSZip XML replacement), `webpage-filler.ts` (JS script generation)
- Dispatcher: `executeFill()` from `src/lib/fill/index.ts` — routes by `TargetType`
- `buildFillContext()` filters to approved mappings, resolves intended values (`userOverrideValue ?? transformedValue`)
- Fill + verify runs synchronously in one API call (sub-second for PDF/DOCX, instant for webpage)
- `FillAction` model tracks per-field status: `PENDING → APPLIED → VERIFIED` (or `FAILED`/`SKIPPED`)
- `TargetAsset.filledStoragePath` stores the filled PDF/DOCX in storage
- Webpage fills produce a JS snippet (not persisted) — user copies and runs in browser console
- Re-fill support: POST to fill API deletes existing FillActions and overwrites filledStoragePath
- DOCX caveat: placeholders split across XML formatting runs will fail — must be contiguous `{{placeholder}}` text

### Session Completion
- `POST /api/sessions/[id]/complete` — transitions `FILLED → COMPLETED`
- Review step shows FillReport summary + FillActionsTable + download link
```

- [ ] **Step 3: Add plan document reference**

```markdown
- Phase 5: `docs/superpowers/plans/2026-04-08-ivm-phase5-fill-verification.md`
```

- [ ] **Step 4: Update File Organization**

Add to the file tree:

```
    ai/                   # ... (existing)
    fill/                 # Fill execution engines (PDF/DOCX/webpage)
```

Add to API routes:

```
        fill/             # Execute fill (POST) + fetch results (GET)
          download/       # Download filled document (GET)
        complete/         # Mark session completed (POST)
```

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md for phase 5"
```

---

## Verification

After all tasks are complete, verify end-to-end:

1. **Database migration**: `npx prisma migrate status` — should show all migrations applied
2. **TypeScript**: `npx tsc --noEmit` — should pass with no errors
3. **PDF fill flow**:
   - Create a session, upload a source, extract, set a PDF target with AcroForm fields, propose + accept mappings
   - Navigate to Fill step → click "Execute Fill"
   - Verify: report shows verified count, download button works, downloaded PDF has filled values
4. **DOCX fill flow**:
   - Same as above but with a DOCX containing `{{placeholder}}` patterns
   - Verify: downloaded DOCX has placeholders replaced with values
5. **Webpage fill flow**:
   - Same as above but with a webpage URL target
   - Verify: JS script is displayed with copy button, script references correct CSS selectors
6. **Review step**:
   - Navigate to Review → verify report card and actions table display correctly
   - Click "Complete Session" → verify session status changes to COMPLETED
   - Verify stepper shows completed state
7. **Re-fill**: Go back to Fill step, click "Re-fill", verify new results replace old ones

---

## Known Limitations (Document for Phase 7)

- **DOCX placeholder split**: If Word splits `{{placeholder}}` across XML runs (e.g., due to spell-check styling), the fill will fail for that field. A future enhancement could normalize runs before replacement.
- **Webpage verification**: Server-side verification is impossible for webpage targets. User must verify manually.
- **No partial re-fill**: Re-fill replaces all actions. A future enhancement could allow re-filling individual failed fields.
- **No fill preview**: User sees results after execution, not before. A preview step could show intended values in context.
