# IVM Phase 3 — Target Ingestion (Web/PDF/DOCX)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable users to select a target (webpage URL, interactive PDF, or DOCX template) and auto-detect fillable fields from it.

**Architecture:** Target step uses a type-selector → input → inspect → preview flow. Three inspection engines (cheerio for HTML, pdf-lib for AcroForm, mammoth for DOCX placeholders) run server-side. API follows existing upload/replace pattern with ownership checks.

**Tech Stack:** cheerio (HTML parsing), pdf-lib (PDF form fields), mammoth (DOCX text extraction), Zod v4 (validation)

---

## Context

Phase 2 delivered source ingestion and AI extraction. Users can now upload documents and get structured fields extracted via Claude. Phase 3 adds the other half — target ingestion. After Phase 3, users can:

1. Choose a target type (WEBPAGE, PDF, or DOCX)
2. For WEBPAGE: enter a URL → server fetches HTML and extracts `<input>`, `<select>`, `<textarea>` elements
3. For PDF: upload a PDF → server detects AcroForm interactive fields via pdf-lib
4. For DOCX: upload a DOCX → server extracts `{{placeholder}}` patterns via mammoth
5. See detected target fields in a read-only review table
6. Session advances: status `EXTRACTED → TARGET_SET`, currentStep `TARGET`

**No Prisma migration needed** — `TargetAsset` model, `TargetType` enum, and `FillSessionStatus.TARGET_SET` already exist. `AuditEvent.eventType` is a free-form `String`.

---

## File Structure

```
New files:
  src/lib/validations/target.ts          — Zod schemas for target submission
  src/lib/target/inspect-webpage.ts      — HTML form field detection via cheerio
  src/lib/target/inspect-pdf.ts          — AcroForm field detection via pdf-lib
  src/lib/target/inspect-docx.ts         — {{placeholder}} detection via mammoth
  src/lib/target/inspect.ts              — Dispatcher routing by TargetType
  src/app/api/sessions/[id]/target/route.ts — POST/GET/DELETE target API
  src/components/sessions/target-type-selector.tsx — Three-card type picker
  src/components/sessions/target-url-input.tsx     — URL input for WEBPAGE
  src/components/sessions/target-file-upload.tsx   — File upload for PDF/DOCX
  src/components/sessions/target-fields-table.tsx  — Read-only detected fields table
  src/components/sessions/target-preview.tsx        — Target info + fields display
  src/components/sessions/target-step-client.tsx    — Step orchestrator

Modified files:
  src/types/target.ts                    — Add TargetAssetData interface
  src/app/(dashboard)/sessions/[id]/target/page.tsx — Replace EmptyState with server component
```

---

## Task Breakdown (7 tasks)

### Task 1: Install dependencies

- [ ] **Step 1: Install npm packages**

```bash
npm install cheerio pdf-lib mammoth
```

- `cheerio`: HTML parsing for webpage form field detection
- `pdf-lib`: PDF AcroForm field enumeration
- `mammoth`: DOCX-to-text conversion for `{{placeholder}}` detection

All three ship their own TypeScript types — no `@types/*` packages needed.

- [ ] **Step 2: Commit**

```bash
git add package.json package-lock.json
git commit -m "feat: add target inspection deps"
```

---

### Task 2: Type definitions + validation schemas

**Files:**
- Modify: `src/types/target.ts`
- Create: `src/lib/validations/target.ts`

- [ ] **Step 1: Add TargetAssetData to types**

Add to `src/types/target.ts`:

```typescript
export interface TargetAssetData {
  id: string;
  targetType: TargetType;
  url: string | null;
  fileName: string | null;
  detectedFields: TargetField[];
  fieldCount: number;
  isSupported: boolean;
  unsupportedReason: string | null;
  inspectedAt: string | null;
}
```

This is the client-side representation analogous to `SourceAssetData` in `src/types/extraction.ts`.

- [ ] **Step 2: Create validation schemas**

Create `src/lib/validations/target.ts`:

```typescript
import { z } from "zod";

export const targetWebpageSchema = z.object({
  targetType: z.literal("WEBPAGE"),
  url: z.string().url("Must be a valid URL").max(2000, "URL too long"),
});

export const targetFileSchema = z.object({
  targetType: z.enum(["PDF", "DOCX"]),
});

export const TARGET_MIME_TYPES = {
  PDF: "application/pdf",
  DOCX: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
} as const;

export const TARGET_MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

export function validateTargetFile(
  file: { size: number; type: string; name: string },
  targetType: "PDF" | "DOCX"
): { valid: boolean; error?: string } {
  const expectedMime = TARGET_MIME_TYPES[targetType];
  if (file.type !== expectedMime) {
    return { valid: false, error: `Expected ${targetType} file, got ${file.type}` };
  }
  if (file.size > TARGET_MAX_FILE_SIZE) {
    return { valid: false, error: `File too large. Maximum: 10 MB` };
  }
  if (file.size === 0) {
    return { valid: false, error: "File is empty" };
  }
  return { valid: true };
}
```

- [ ] **Step 3: Commit**

```bash
git add src/types/target.ts src/lib/validations/target.ts
git commit -m "feat: target types and validation"
```

---

### Task 3: Target inspection library

**Files:**
- Create: `src/lib/target/inspect-webpage.ts`
- Create: `src/lib/target/inspect-pdf.ts`
- Create: `src/lib/target/inspect-docx.ts`
- Create: `src/lib/target/inspect.ts`

- [ ] **Step 1: Create inspect-webpage.ts**

Create `src/lib/target/inspect-webpage.ts`:

```typescript
import * as cheerio from "cheerio";
import { randomUUID } from "crypto";
import type { TargetField } from "@/types/target";

export interface InspectResult {
  fields: TargetField[];
  isSupported: boolean;
  unsupportedReason?: string;
}

const FETCH_TIMEOUT = 15_000;
const MAX_BODY_SIZE = 2 * 1024 * 1024; // 2MB

const INPUT_TYPE_MAP: Record<string, TargetField["fieldType"]> = {
  text: "text",
  email: "email",
  number: "number",
  date: "date",
  checkbox: "checkbox",
  radio: "radio",
  tel: "text",
  url: "text",
  password: "text",
  search: "text",
};

const SKIP_TYPES = new Set(["hidden", "submit", "button", "reset", "image", "file"]);
const SKIP_NAMES = new Set(["_token", "csrf", "csrfmiddlewaretoken", "_csrf", "authenticity_token"]);

export async function inspectWebpage(url: string): Promise<InspectResult> {
  let res: Response;
  try {
    res = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT),
      redirect: "follow",
      headers: { "User-Agent": "IVM-TargetInspector/1.0" },
    });
  } catch {
    return { fields: [], isSupported: false, unsupportedReason: "Could not reach URL (timeout or network error)" };
  }

  if (!res.ok) {
    return { fields: [], isSupported: false, unsupportedReason: `HTTP ${res.status}: ${res.statusText}` };
  }

  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("text/html")) {
    return { fields: [], isSupported: false, unsupportedReason: `Not an HTML page (Content-Type: ${contentType})` };
  }

  const html = await res.text();
  if (html.length > MAX_BODY_SIZE) {
    return { fields: [], isSupported: false, unsupportedReason: "Page too large (over 2 MB)" };
  }

  const $ = cheerio.load(html);
  const fields: TargetField[] = [];

  // Process <input> elements
  $("input").each((_, el) => {
    const $el = $(el);
    const type = ($el.attr("type") ?? "text").toLowerCase();
    if (SKIP_TYPES.has(type)) return;
    const name = $el.attr("name") ?? $el.attr("id") ?? "";
    if (!name || SKIP_NAMES.has(name)) return;

    fields.push({
      id: randomUUID(),
      name,
      label: findLabel($, $el, name),
      fieldType: INPUT_TYPE_MAP[type] ?? "other",
      required: $el.attr("required") !== undefined,
      currentValue: $el.attr("value") ?? undefined,
      selector: buildSelector($el),
    });
  });

  // Process <select> elements
  $("select").each((_, el) => {
    const $el = $(el);
    const name = $el.attr("name") ?? $el.attr("id") ?? "";
    if (!name || SKIP_NAMES.has(name)) return;

    const options = $el.find("option").map((_, opt) => $(opt).attr("value") ?? $(opt).text().trim()).get().filter(Boolean);

    fields.push({
      id: randomUUID(),
      name,
      label: findLabel($, $el, name),
      fieldType: "select",
      required: $el.attr("required") !== undefined,
      options,
      selector: buildSelector($el),
    });
  });

  // Process <textarea> elements
  $("textarea").each((_, el) => {
    const $el = $(el);
    const name = $el.attr("name") ?? $el.attr("id") ?? "";
    if (!name || SKIP_NAMES.has(name)) return;

    fields.push({
      id: randomUUID(),
      name,
      label: findLabel($, $el, name),
      fieldType: "textarea",
      required: $el.attr("required") !== undefined,
      currentValue: $el.text().trim() || undefined,
      selector: buildSelector($el),
    });
  });

  return { fields, isSupported: true };
}

function findLabel(
  $: cheerio.CheerioAPI,
  $el: cheerio.Cheerio<cheerio.Element>,
  fallbackName: string
): string {
  // 1. Associated <label> via for="id"
  const id = $el.attr("id");
  if (id) {
    const labelText = $(`label[for="${id}"]`).first().text().trim();
    if (labelText) return labelText;
  }
  // 2. Parent <label>
  const parentLabel = $el.closest("label").text().trim();
  if (parentLabel) return parentLabel;
  // 3. aria-label
  const ariaLabel = $el.attr("aria-label");
  if (ariaLabel) return ariaLabel;
  // 4. placeholder
  const placeholder = $el.attr("placeholder");
  if (placeholder) return placeholder;
  // 5. Fallback: humanize name
  return fallbackName.replace(/[_-]/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2");
}

function buildSelector($el: cheerio.Cheerio<cheerio.Element>): string {
  const id = $el.attr("id");
  if (id) return `#${id}`;
  const name = $el.attr("name");
  if (name) return `[name="${name}"]`;
  return "";
}
```

- [ ] **Step 2: Create inspect-pdf.ts**

Create `src/lib/target/inspect-pdf.ts`:

```typescript
import { PDFDocument, PDFTextField, PDFCheckBox, PDFDropdown, PDFRadioGroup, PDFOptionList } from "pdf-lib";
import { randomUUID } from "crypto";
import type { TargetField } from "@/types/target";
import type { InspectResult } from "./inspect-webpage";

export async function inspectPdf(buffer: Buffer): Promise<InspectResult> {
  let pdf: PDFDocument;
  try {
    pdf = await PDFDocument.load(buffer, { ignoreEncryption: true });
  } catch {
    return { fields: [], isSupported: false, unsupportedReason: "Could not parse PDF (corrupt or encrypted)" };
  }

  let form;
  try {
    form = pdf.getForm();
  } catch {
    // No form in this PDF — valid but no interactive fields
    return { fields: [], isSupported: true };
  }

  const pdfFields = form.getFields();
  const fields: TargetField[] = [];

  for (const field of pdfFields) {
    const name = field.getName();
    let fieldType: TargetField["fieldType"] = "other";
    let currentValue: string | undefined;
    let options: string[] | undefined;

    if (field instanceof PDFTextField) {
      fieldType = "text";
      currentValue = field.getText() ?? undefined;
    } else if (field instanceof PDFCheckBox) {
      fieldType = "checkbox";
      currentValue = field.isChecked() ? "true" : "false";
    } else if (field instanceof PDFDropdown) {
      fieldType = "select";
      options = field.getOptions();
      const selected = field.getSelected();
      currentValue = selected.length > 0 ? selected[0] : undefined;
    } else if (field instanceof PDFRadioGroup) {
      fieldType = "radio";
      options = field.getOptions();
      currentValue = field.getSelected() ?? undefined;
    } else if (field instanceof PDFOptionList) {
      fieldType = "select";
      options = field.getOptions();
      const selected = field.getSelected();
      currentValue = selected.length > 0 ? selected[0] : undefined;
    }

    fields.push({
      id: randomUUID(),
      name,
      label: name.replace(/[_.-]/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2"),
      fieldType,
      required: false, // pdf-lib does not expose required flag
      currentValue,
      options,
    });
  }

  return { fields, isSupported: true };
}
```

- [ ] **Step 3: Create inspect-docx.ts**

Create `src/lib/target/inspect-docx.ts`:

```typescript
import mammoth from "mammoth";
import { randomUUID } from "crypto";
import type { TargetField } from "@/types/target";
import type { InspectResult } from "./inspect-webpage";

const PLACEHOLDER_REGEX = /\{\{([^}]+)\}\}/g;

const NAME_TYPE_HINTS: Record<string, TargetField["fieldType"]> = {
  email: "email",
  date: "date",
  dob: "date",
  birthday: "date",
  phone: "number",
  tel: "number",
  amount: "number",
  total: "number",
  price: "number",
  quantity: "number",
  count: "number",
  notes: "textarea",
  description: "textarea",
  comments: "textarea",
  address: "textarea",
};

export async function inspectDocx(buffer: Buffer): Promise<InspectResult> {
  let text: string;
  try {
    const result = await mammoth.extractRawText({ buffer });
    text = result.value;
  } catch {
    return { fields: [], isSupported: false, unsupportedReason: "Could not parse DOCX file" };
  }

  const seen = new Set<string>();
  const fields: TargetField[] = [];
  let match: RegExpExecArray | null;

  while ((match = PLACEHOLDER_REGEX.exec(text)) !== null) {
    const raw = match[1].trim();
    if (!raw || seen.has(raw)) continue;
    seen.add(raw);

    const lowerName = raw.toLowerCase();
    const hintKey = Object.keys(NAME_TYPE_HINTS).find((k) => lowerName.includes(k));

    fields.push({
      id: randomUUID(),
      name: raw,
      label: raw.replace(/[_-]/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2"),
      fieldType: hintKey ? NAME_TYPE_HINTS[hintKey] : "text",
      required: false,
    });
  }

  return { fields, isSupported: true };
}
```

- [ ] **Step 4: Create dispatcher inspect.ts**

Create `src/lib/target/inspect.ts`:

```typescript
import type { TargetType } from "@/types/target";
import { inspectWebpage, type InspectResult } from "./inspect-webpage";
import { inspectPdf } from "./inspect-pdf";
import { inspectDocx } from "./inspect-docx";

export type { InspectResult };

export async function inspectTarget(
  targetType: TargetType,
  options: { url?: string; buffer?: Buffer }
): Promise<InspectResult> {
  switch (targetType) {
    case "WEBPAGE": {
      if (!options.url) return { fields: [], isSupported: false, unsupportedReason: "URL is required" };
      return inspectWebpage(options.url);
    }
    case "PDF": {
      if (!options.buffer) return { fields: [], isSupported: false, unsupportedReason: "File buffer is required" };
      return inspectPdf(options.buffer);
    }
    case "DOCX": {
      if (!options.buffer) return { fields: [], isSupported: false, unsupportedReason: "File buffer is required" };
      return inspectDocx(options.buffer);
    }
  }
}
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/target/ src/lib/validations/target.ts
git commit -m "feat: target inspection engines"
```

---

### Task 4: Target API route

**Files:**
- Create: `src/app/api/sessions/[id]/target/route.ts`

Pattern reference: `src/app/api/sessions/[id]/upload/route.ts`

- [ ] **Step 1: Create target API route**

Create `src/app/api/sessions/[id]/target/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getStorageAdapter } from "@/lib/storage";
import { logger } from "@/lib/logger";
import { errorResponse, UnauthorizedError, NotFoundError, ValidationError } from "@/lib/errors";
import { targetWebpageSchema, validateTargetFile } from "@/lib/validations/target";
import { inspectTarget } from "@/lib/target/inspect";
import type { TargetField } from "@/types/target";

type RouteContext = { params: Promise<{ id: string }> };

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 100);
}

// GET — Return current target asset
export async function GET(req: Request, { params }: RouteContext) {
  try {
    const session = await auth();
    if (!session?.user?.id) throw new UnauthorizedError();
    const { id } = await params;

    const fillSession = await db.fillSession.findFirst({
      where: { id, userId: session.user.id },
      include: {
        targetAssets: {
          orderBy: { inspectedAt: "desc" },
          take: 1,
        },
      },
    });
    if (!fillSession) throw new NotFoundError("Session", id);

    const target = fillSession.targetAssets[0] ?? null;
    if (!target) return NextResponse.json({ target: null });

    return NextResponse.json({
      target: {
        id: target.id,
        targetType: target.targetType,
        url: target.url,
        fileName: target.fileName,
        detectedFields: target.detectedFields as TargetField[],
        fieldCount: (target.detectedFields as unknown[]).length,
        isSupported: target.isSupported,
        unsupportedReason: target.unsupportedReason,
        inspectedAt: target.inspectedAt?.toISOString() ?? null,
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}

// POST — Create/replace target asset
export async function POST(req: Request, { params }: RouteContext) {
  try {
    const session = await auth();
    if (!session?.user?.id) throw new UnauthorizedError();
    const { id } = await params;

    const fillSession = await db.fillSession.findFirst({
      where: { id, userId: session.user.id },
      include: { targetAssets: true },
    });
    if (!fillSession) throw new NotFoundError("Session", id);

    // Require at least EXTRACTED status before setting target
    const validStatuses = ["EXTRACTED", "TARGET_SET", "MAPPED", "FILLED", "REVIEWED"];
    if (!validStatuses.includes(fillSession.status)) {
      throw new ValidationError("Complete extraction before setting a target", {
        status: ["Session must be in EXTRACTED state or later"],
      });
    }

    const storage = getStorageAdapter();

    // Replace semantics — delete existing targets
    if (fillSession.targetAssets.length > 0) {
      await Promise.all(
        fillSession.targetAssets
          .filter((t) => t.storagePath)
          .map((t) =>
            storage.delete(t.storagePath!).catch((err) => {
              logger.warn({ err, storagePath: t.storagePath }, "Failed to delete old target file");
            })
          )
      );
      await db.targetAsset.deleteMany({ where: { fillSessionId: id } });
    }

    const contentType = req.headers.get("content-type") ?? "";
    let targetAsset;

    if (contentType.includes("application/json")) {
      // WEBPAGE target
      const body = await req.json();
      const parsed = targetWebpageSchema.parse(body);

      const result = await inspectTarget("WEBPAGE", { url: parsed.url });

      targetAsset = await db.targetAsset.create({
        data: {
          fillSessionId: id,
          targetType: "WEBPAGE",
          url: parsed.url,
          detectedFields: JSON.parse(JSON.stringify(result.fields)),
          isSupported: result.isSupported,
          unsupportedReason: result.unsupportedReason ?? null,
          inspectedAt: new Date(),
        },
      });
    } else if (contentType.includes("multipart/form-data")) {
      // PDF or DOCX target
      const formData = await req.formData();
      const file = formData.get("file");
      const targetType = formData.get("targetType") as string;

      if (!file || !(file instanceof File)) {
        throw new ValidationError("No file provided", { file: ["File is required"] });
      }
      if (targetType !== "PDF" && targetType !== "DOCX") {
        throw new ValidationError("Invalid target type", { targetType: ["Must be PDF or DOCX"] });
      }

      const validation = validateTargetFile(
        { size: file.size, type: file.type, name: file.name },
        targetType
      );
      if (!validation.valid) {
        throw new ValidationError(validation.error!, { file: [validation.error!] });
      }

      const buffer = Buffer.from(await file.arrayBuffer());
      const sanitized = sanitizeFileName(file.name);
      const storageKey = `sessions/${id}/targets/${Date.now()}-${sanitized}`;
      await storage.upload(storageKey, buffer, file.type);

      const result = await inspectTarget(targetType, { buffer });

      targetAsset = await db.targetAsset.create({
        data: {
          fillSessionId: id,
          targetType,
          fileName: file.name,
          storagePath: storageKey,
          detectedFields: JSON.parse(JSON.stringify(result.fields)),
          isSupported: result.isSupported,
          unsupportedReason: result.unsupportedReason ?? null,
          inspectedAt: new Date(),
        },
      });
    } else {
      throw new ValidationError("Invalid content type", {
        contentType: ["Expected application/json or multipart/form-data"],
      });
    }

    // Update session status
    await Promise.all([
      db.fillSession.updateMany({
        where: { id, userId: session.user.id },
        data: { status: "TARGET_SET", currentStep: "TARGET" },
      }),
      db.auditEvent.create({
        data: {
          fillSessionId: id,
          eventType: "TARGET_SET",
          actor: "USER",
          payload: {
            targetType: targetAsset.targetType,
            fieldCount: (targetAsset.detectedFields as unknown[]).length,
            isSupported: targetAsset.isSupported,
            targetAssetId: targetAsset.id,
          },
        },
      }),
    ]);

    logger.info(
      { sessionId: id, targetAssetId: targetAsset.id, targetType: targetAsset.targetType },
      "Target asset created"
    );

    const fields = targetAsset.detectedFields as TargetField[];
    return NextResponse.json(
      {
        id: targetAsset.id,
        targetType: targetAsset.targetType,
        url: targetAsset.url,
        fileName: targetAsset.fileName,
        detectedFields: fields,
        fieldCount: fields.length,
        isSupported: targetAsset.isSupported,
        unsupportedReason: targetAsset.unsupportedReason,
        inspectedAt: targetAsset.inspectedAt?.toISOString() ?? null,
      },
      { status: 201 }
    );
  } catch (err) {
    return errorResponse(err);
  }
}

// DELETE — Remove target to allow re-selection
export async function DELETE(req: Request, { params }: RouteContext) {
  try {
    const session = await auth();
    if (!session?.user?.id) throw new UnauthorizedError();
    const { id } = await params;

    const fillSession = await db.fillSession.findFirst({
      where: { id, userId: session.user.id },
      include: { targetAssets: true },
    });
    if (!fillSession) throw new NotFoundError("Session", id);

    const storage = getStorageAdapter();
    await Promise.all(
      fillSession.targetAssets
        .filter((t) => t.storagePath)
        .map((t) =>
          storage.delete(t.storagePath!).catch((err) => {
            logger.warn({ err, storagePath: t.storagePath }, "Failed to delete target file");
          })
        )
    );
    await db.targetAsset.deleteMany({ where: { fillSessionId: id } });

    await Promise.all([
      db.fillSession.updateMany({
        where: { id, userId: session.user.id },
        data: { status: "EXTRACTED", currentStep: "TARGET" },
      }),
      db.auditEvent.create({
        data: {
          fillSessionId: id,
          eventType: "TARGET_REMOVED",
          actor: "USER",
          payload: {},
        },
      }),
    ]);

    return NextResponse.json({ success: true });
  } catch (err) {
    return errorResponse(err);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/sessions/[id]/target/
git commit -m "feat: target API routes"
```

---

### Task 5: UI components

**Files:**
- Create: `src/components/sessions/target-type-selector.tsx`
- Create: `src/components/sessions/target-url-input.tsx`
- Create: `src/components/sessions/target-file-upload.tsx`
- Create: `src/components/sessions/target-fields-table.tsx`
- Create: `src/components/sessions/target-preview.tsx`

- [ ] **Step 1: Create target-type-selector.tsx**

Create `src/components/sessions/target-type-selector.tsx`:

```typescript
"use client";

import { Globe, FileText, FileType } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TargetType } from "@/types/target";

interface TargetTypeSelectorProps {
  onSelect: (type: TargetType) => void;
}

const TARGET_OPTIONS: { type: TargetType; icon: typeof Globe; title: string; description: string }[] = [
  {
    type: "WEBPAGE",
    icon: Globe,
    title: "Webpage",
    description: "Enter a URL to detect form fields",
  },
  {
    type: "PDF",
    icon: FileText,
    title: "PDF Form",
    description: "Upload an interactive PDF with form fields",
  },
  {
    type: "DOCX",
    icon: FileType,
    title: "DOCX Template",
    description: "Upload a Word document with {{placeholders}}",
  },
];

export function TargetTypeSelector({ onSelect }: TargetTypeSelectorProps) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Choose the type of target you want to fill with the extracted data.
      </p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {TARGET_OPTIONS.map(({ type, icon: Icon, title, description }) => (
          <button
            key={type}
            onClick={() => onSelect(type)}
            className={cn(
              "flex flex-col items-center gap-3 rounded-lg border border-border bg-card p-6",
              "text-center transition-colors",
              "hover:border-foreground/20 hover:bg-muted/50",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            )}
          >
            <Icon className="h-8 w-8 text-muted-foreground" />
            <div>
              <p className="font-medium text-foreground">{title}</p>
              <p className="mt-1 text-xs text-muted-foreground">{description}</p>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create target-url-input.tsx**

Create `src/components/sessions/target-url-input.tsx`:

```typescript
"use client";

import { useState, useCallback } from "react";
import { ArrowLeft, Search, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormError } from "@/components/ui/form-error";
import type { TargetAssetData } from "@/types/target";

interface TargetUrlInputProps {
  sessionId: string;
  onComplete: (target: TargetAssetData) => void;
  onBack: () => void;
}

export function TargetUrlInput({ sessionId, onComplete, onBack }: TargetUrlInputProps) {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleInspect = useCallback(async () => {
    if (!url.trim()) return;
    setLoading(true);
    setError("");

    try {
      const res = await fetch(`/api/sessions/${sessionId}/target`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetType: "WEBPAGE", url: url.trim() }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to inspect webpage");
      }

      const target: TargetAssetData = await res.json();
      onComplete(target);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to inspect webpage");
    } finally {
      setLoading(false);
    }
  }, [url, sessionId, onComplete]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="mr-1 h-4 w-4" />
          Back
        </Button>
        <span className="text-sm text-muted-foreground">Enter the webpage URL to inspect</span>
      </div>

      <div className="flex gap-2">
        <Input
          type="url"
          placeholder="https://example.com/form"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleInspect()}
          disabled={loading}
          className="flex-1"
        />
        <Button onClick={handleInspect} disabled={loading || !url.trim()}>
          {loading ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Search className="mr-2 h-4 w-4" />
          )}
          {loading ? "Inspecting..." : "Inspect"}
        </Button>
      </div>

      <FormError message={error} />
    </div>
  );
}
```

- [ ] **Step 3: Create target-file-upload.tsx**

Create `src/components/sessions/target-file-upload.tsx`:

```typescript
"use client";

import { useState, useCallback, useRef } from "react";
import { ArrowLeft, Upload, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/form-error";
import { cn } from "@/lib/utils";
import type { TargetAssetData, TargetType } from "@/types/target";

interface TargetFileUploadProps {
  sessionId: string;
  targetType: Extract<TargetType, "PDF" | "DOCX">;
  onComplete: (target: TargetAssetData) => void;
  onBack: () => void;
}

const ACCEPT_MAP = { PDF: ".pdf", DOCX: ".docx" } as const;

export function TargetFileUpload({ sessionId, targetType, onComplete, onBack }: TargetFileUploadProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState(0);
  const [dragActive, setDragActive] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const uploadFile = useCallback(
    (file: File) => {
      setLoading(true);
      setError("");
      setProgress(0);

      const formData = new FormData();
      formData.append("file", file);
      formData.append("targetType", targetType);

      const xhr = new XMLHttpRequest();

      xhr.upload.addEventListener("progress", (e) => {
        if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 100));
      });

      xhr.addEventListener("load", () => {
        setLoading(false);
        if (xhr.status === 201) {
          const target: TargetAssetData = JSON.parse(xhr.responseText);
          onComplete(target);
        } else {
          try {
            const data = JSON.parse(xhr.responseText);
            setError(data.error || `Upload failed (${xhr.status})`);
          } catch {
            setError(`Upload failed (${xhr.status})`);
          }
        }
      });

      xhr.addEventListener("error", () => {
        setLoading(false);
        setError("Network error during upload");
      });

      xhr.open("POST", `/api/sessions/${sessionId}/target`);
      xhr.send(formData);
    },
    [sessionId, targetType, onComplete]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragActive(false);
      const file = e.dataTransfer.files[0];
      if (file) uploadFile(file);
    },
    [uploadFile]
  );

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) uploadFile(file);
    },
    [uploadFile]
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="mr-1 h-4 w-4" />
          Back
        </Button>
        <span className="text-sm text-muted-foreground">
          Upload a {targetType === "PDF" ? "PDF with form fields" : "DOCX with {{placeholders}}"}
        </span>
      </div>

      <div
        onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
        onDragLeave={() => setDragActive(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-12 transition-colors",
          dragActive ? "border-foreground/40 bg-muted/50" : "border-border hover:border-foreground/20",
          loading && "pointer-events-none opacity-60"
        )}
      >
        {loading ? (
          <>
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            <p className="mt-2 text-sm text-muted-foreground">Uploading & inspecting... {progress}%</p>
          </>
        ) : (
          <>
            <Upload className="h-8 w-8 text-muted-foreground" />
            <p className="mt-2 text-sm text-muted-foreground">
              Drop your {targetType} file here or click to browse
            </p>
            <p className="mt-1 text-xs text-muted-foreground/60">Max 10 MB</p>
          </>
        )}
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT_MAP[targetType]}
          onChange={handleFileSelect}
          className="hidden"
        />
      </div>

      <FormError message={error} />
    </div>
  );
}
```

- [ ] **Step 4: Create target-fields-table.tsx**

Create `src/components/sessions/target-fields-table.tsx`:

```typescript
import { Badge } from "@/components/ui/badge";
import type { TargetField } from "@/types/target";

interface TargetFieldsTableProps {
  fields: TargetField[];
}

export function TargetFieldsTable({ fields }: TargetFieldsTableProps) {
  if (fields.length === 0) {
    return (
      <p className="rounded-lg border border-border bg-muted/30 p-4 text-center text-sm text-muted-foreground">
        No fillable fields detected in this target.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/50">
            <th className="px-4 py-2 text-left font-medium text-muted-foreground">Name</th>
            <th className="px-4 py-2 text-left font-medium text-muted-foreground">Label</th>
            <th className="px-4 py-2 text-left font-medium text-muted-foreground">Type</th>
            <th className="px-4 py-2 text-left font-medium text-muted-foreground">Required</th>
            <th className="px-4 py-2 text-left font-medium text-muted-foreground">Current Value</th>
          </tr>
        </thead>
        <tbody>
          {fields.map((field) => (
            <tr key={field.id} className="border-b border-border last:border-0">
              <td className="px-4 py-2 font-mono text-xs text-foreground">{field.name}</td>
              <td className="px-4 py-2 text-foreground">{field.label}</td>
              <td className="px-4 py-2">
                <Badge variant="secondary">{field.fieldType}</Badge>
              </td>
              <td className="px-4 py-2">
                {field.required ? (
                  <Badge variant="default">Yes</Badge>
                ) : (
                  <span className="text-muted-foreground">No</span>
                )}
              </td>
              <td className="px-4 py-2 text-muted-foreground">
                {field.currentValue || "-"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 5: Create target-preview.tsx**

Create `src/components/sessions/target-preview.tsx`:

```typescript
import { Globe, FileText, FileType, AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TargetFieldsTable } from "./target-fields-table";
import type { TargetAssetData } from "@/types/target";

interface TargetPreviewProps {
  target: TargetAssetData;
  onReplace: () => void;
}

const TYPE_ICONS = { WEBPAGE: Globe, PDF: FileText, DOCX: FileType } as const;

export function TargetPreview({ target, onReplace }: TargetPreviewProps) {
  const Icon = TYPE_ICONS[target.targetType];

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between rounded-lg border border-border bg-card p-4">
        <div className="flex items-center gap-3">
          <Icon className="h-6 w-6 text-muted-foreground" />
          <div>
            <div className="flex items-center gap-2">
              <Badge variant="secondary">{target.targetType}</Badge>
              <span className="text-sm text-muted-foreground">
                {target.fieldCount} field{target.fieldCount !== 1 ? "s" : ""} detected
              </span>
            </div>
            <p className="mt-1 text-sm text-foreground">
              {target.url ?? target.fileName ?? "Unknown target"}
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={onReplace}>
          Replace
        </Button>
      </div>

      {!target.isSupported && target.unsupportedReason && (
        <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/30 p-4">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
          <p className="text-sm text-muted-foreground">{target.unsupportedReason}</p>
        </div>
      )}

      <TargetFieldsTable fields={target.detectedFields} />
    </div>
  );
}
```

- [ ] **Step 6: Commit**

```bash
git add src/components/sessions/target-*.tsx
git commit -m "feat: target step UI components"
```

---

### Task 6: Target step client (orchestrator)

**Files:**
- Create: `src/components/sessions/target-step-client.tsx`

- [ ] **Step 1: Create target-step-client.tsx**

Create `src/components/sessions/target-step-client.tsx`:

```typescript
"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TargetTypeSelector } from "./target-type-selector";
import { TargetUrlInput } from "./target-url-input";
import { TargetFileUpload } from "./target-file-upload";
import { TargetPreview } from "./target-preview";
import type { TargetAssetData, TargetType } from "@/types/target";

interface TargetStepClientProps {
  sessionId: string;
  hasExtraction: boolean;
  initialTarget: TargetAssetData | null;
}

type Step = "select" | "input" | "preview";

export function TargetStepClient({ sessionId, hasExtraction, initialTarget }: TargetStepClientProps) {
  const router = useRouter();
  const [step, setStep] = useState<Step>(initialTarget ? "preview" : "select");
  const [selectedType, setSelectedType] = useState<TargetType | null>(
    initialTarget?.targetType ?? null
  );
  const [target, setTarget] = useState<TargetAssetData | null>(initialTarget);

  const handleTypeSelect = useCallback((type: TargetType) => {
    setSelectedType(type);
    setStep("input");
  }, []);

  const handleComplete = useCallback(
    (newTarget: TargetAssetData) => {
      setTarget(newTarget);
      setStep("preview");
      router.refresh();
    },
    [router]
  );

  const handleReplace = useCallback(() => {
    setSelectedType(null);
    setTarget(null);
    setStep("select");
  }, []);

  const handleBack = useCallback(() => {
    setSelectedType(null);
    setStep("select");
  }, []);

  if (!hasExtraction) {
    return (
      <div className="rounded-lg border border-border bg-muted/30 p-8 text-center">
        <p className="text-sm text-muted-foreground">
          Complete field extraction first before selecting a target.
        </p>
        <Button
          variant="outline"
          size="sm"
          className="mt-3"
          onClick={() => router.push(`/sessions/${sessionId}/extract`)}
        >
          Go to Extraction
        </Button>
      </div>
    );
  }

  if (step === "select") {
    return <TargetTypeSelector onSelect={handleTypeSelect} />;
  }

  if (step === "input" && selectedType) {
    if (selectedType === "WEBPAGE") {
      return (
        <TargetUrlInput
          sessionId={sessionId}
          onComplete={handleComplete}
          onBack={handleBack}
        />
      );
    }
    return (
      <TargetFileUpload
        sessionId={sessionId}
        targetType={selectedType}
        onComplete={handleComplete}
        onBack={handleBack}
      />
    );
  }

  if (step === "preview" && target) {
    return (
      <div className="space-y-4">
        <TargetPreview target={target} onReplace={handleReplace} />
        <div className="flex justify-end">
          <Button onClick={() => router.push(`/sessions/${sessionId}/map`)}>
            Continue to Mapping
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </div>
      </div>
    );
  }

  return null;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/sessions/target-step-client.tsx
git commit -m "feat: target step orchestrator"
```

---

### Task 7: Wire target step page

**Files:**
- Modify: `src/app/(dashboard)/sessions/[id]/target/page.tsx`

- [ ] **Step 1: Replace EmptyState with server component**

Replace the contents of `src/app/(dashboard)/sessions/[id]/target/page.tsx`:

```typescript
import { requireAuth } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { notFound } from "next/navigation";
import { TargetStepClient } from "@/components/sessions/target-step-client";
import type { TargetField } from "@/types/target";

export default async function TargetStepPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireAuth();
  const { id } = await params;

  const fillSession = await db.fillSession.findFirst({
    where: { id, userId: session.user.id },
    include: {
      extractionResults: {
        where: { status: "COMPLETED" },
        take: 1,
        select: { id: true },
      },
      targetAssets: {
        orderBy: { inspectedAt: "desc" },
        take: 1,
      },
    },
  });

  if (!fillSession) notFound();

  const hasExtraction = fillSession.extractionResults.length > 0;
  const targetAsset = fillSession.targetAssets[0] ?? null;

  const initialTarget = targetAsset
    ? {
        id: targetAsset.id,
        targetType: targetAsset.targetType as "WEBPAGE" | "PDF" | "DOCX",
        url: targetAsset.url,
        fileName: targetAsset.fileName,
        detectedFields: targetAsset.detectedFields as TargetField[],
        fieldCount: (targetAsset.detectedFields as unknown[]).length,
        isSupported: targetAsset.isSupported,
        unsupportedReason: targetAsset.unsupportedReason,
        inspectedAt: targetAsset.inspectedAt?.toISOString() ?? null,
      }
    : null;

  return (
    <TargetStepClient
      sessionId={id}
      hasExtraction={hasExtraction}
      initialTarget={initialTarget}
    />
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Fix any type errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/(dashboard)/sessions/[id]/target/page.tsx
git commit -m "feat: wire target step page"
```

---

## Verification

After all tasks complete, verify end-to-end:

1. **Start dev server**: `npm run dev`
2. **Create a session**: Navigate to dashboard, create new session
3. **Upload a source + extract**: Upload a test PDF/image, run extraction
4. **Test WEBPAGE target**: On target step, select "Webpage", enter a URL with a form (e.g. a public form page). Verify fields are detected and displayed.
5. **Test PDF target**: Replace target, select "PDF Form", upload an interactive PDF (one with AcroForm fields). Verify form fields appear in the table.
6. **Test DOCX target**: Replace target, select "DOCX Template", upload a DOCX with `{{placeholder}}` text. Verify placeholders are detected.
7. **Test edge cases**:
   - URL that returns non-HTML (e.g. a JSON API) → shows unsupported reason
   - PDF with no form fields → shows "no fields detected" message
   - DOCX with no placeholders → shows "no fields detected" message
   - Network timeout on unreachable URL → shows error
8. **Verify session state**: After setting a target, confirm session status is `TARGET_SET` and step is `TARGET`
9. **Verify replace flow**: Click "Replace", select a different target type, confirm old target is deleted
