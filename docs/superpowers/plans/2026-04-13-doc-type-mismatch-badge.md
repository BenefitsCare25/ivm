# Doc Type Mismatch Badge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a scrape session has an expected document type and a downloaded PDF is classified as a different type, persist a `DOC_TYPE_MATCH` ValidationResult and surface it as a visible badge in the items table — same column as existing FWA signals.

**Architecture:** Reuse the existing `ValidationResult` pipeline. Add a `checkDocTypeMatch()` helper to `validator.ts`, call it in the intelligence block of the item-detail worker, then extend the session items page query and `TrackedItemsTable` UI to display it alongside FWA badges.

**Tech Stack:** TypeScript, Prisma (existing `ValidationResult` model), Next.js App Router RSC, React client component (TrackedItemsTable)

---

## File Map

| Action | File | What changes |
|--------|------|--------------|
| Modify | `src/lib/intelligence/validator.ts` | Add `checkDocTypeMatch()` export |
| Modify | `src/lib/intelligence/index.ts` | Re-export `checkDocTypeMatch` |
| Modify | `src/workers/item-detail-worker.ts` | Call `checkDocTypeMatch()` after classification |
| Modify | `src/app/(dashboard)/portals/[id]/sessions/[sessionId]/page.tsx` | Add `DOC_TYPE_MATCH` to FWA query filter |
| Modify | `src/components/portals/tracked-items-table.tsx` | Add `DOC_TYPE_MATCH` label + priority |

No schema changes — `ValidationResult.ruleType` already includes `"DOC_TYPE_MATCH"` in the TypeScript interface.

---

## Task 1: Add `checkDocTypeMatch()` to validator.ts

**Files:**
- Modify: `src/lib/intelligence/validator.ts`

- [ ] **Step 1: Add the function after `validateRequiredFields`**

Open `src/lib/intelligence/validator.ts`. After the closing brace of `validateRequiredFields` (currently last export), append:

```ts
export async function checkDocTypeMatch(
  classifiedTypeId: string | null,
  classifiedTypeName: string | null,
  expectedTypeId: string,
  expectedTypeName: string,
  options: PersistOptions
): Promise<void> {
  const checks: ValidationCheck[] = [];

  if (!classifiedTypeId) {
    checks.push({
      ruleType: "DOC_TYPE_MATCH",
      status: "WARNING",
      message: `Document type unrecognised — expected "${expectedTypeName}"`,
      metadata: { expectedTypeId, expectedTypeName, classifiedTypeId: null },
    });
  } else if (classifiedTypeId !== expectedTypeId) {
    checks.push({
      ruleType: "DOC_TYPE_MATCH",
      status: "FAIL",
      message: `Wrong document type: got "${classifiedTypeName ?? classifiedTypeId}", expected "${expectedTypeName}"`,
      metadata: { expectedTypeId, expectedTypeName, classifiedTypeId, classifiedTypeName },
    });
  }
  // If IDs match → no record written (implicitly PASS)

  await persistChecks(checks, options);
}
```

- [ ] **Step 2: Verify the file compiles**

```bash
cd C:/Users/huien/IVM && npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors in `validator.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/lib/intelligence/validator.ts
git commit -m "feat: add checkDocTypeMatch validator"
```

---

## Task 2: Re-export from intelligence index

**Files:**
- Modify: `src/lib/intelligence/index.ts`

- [ ] **Step 1: Add the export**

Current line 3 of `src/lib/intelligence/index.ts`:
```ts
export { validateRequiredFields, validateRequiredFieldsSync } from "./validator";
```

Replace with:
```ts
export { validateRequiredFields, validateRequiredFieldsSync, checkDocTypeMatch } from "./validator";
```

- [ ] **Step 2: Verify compiles**

```bash
npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/intelligence/index.ts
git commit -m "feat: re-export checkDocTypeMatch"
```

---

## Task 3: Call `checkDocTypeMatch` in the item-detail worker

**Files:**
- Modify: `src/workers/item-detail-worker.ts`

**Context:** The intelligence pipeline block (lines ~201–238) loops over `fileExtractions`. Inside the loop, after `classifyDocumentType()`, check whether the session has an `expectedDocumentTypeId` and whether the classified type matches. The worker already includes `scrapeSession` (with all its scalar fields, including `expectedDocumentTypeId`) via the `findUniqueOrThrow` include at line ~53.

- [ ] **Step 1: Add `checkDocTypeMatch` to the import**

Current import line (line 11):
```ts
import { classifyDocumentType, fetchDocTypes, validateRequiredFields, checkDuplicate, checkTampering, checkAnomalies, checkPdfMetadata, checkVisualForensics, checkArithmeticConsistency } from "@/lib/intelligence";
```

Replace with:
```ts
import { classifyDocumentType, fetchDocTypes, validateRequiredFields, checkDocTypeMatch, checkDuplicate, checkTampering, checkAnomalies, checkPdfMetadata, checkVisualForensics, checkArithmeticConsistency } from "@/lib/intelligence";
```

- [ ] **Step 2: Insert the doc type check inside the per-file intelligence loop**

Locate the block inside `for (const ext of fileExtractions)` that looks like:

```ts
if (classification.documentTypeId) {
  const matchedDocType = cachedDocTypes?.find((dt) => dt.id === classification.documentTypeId);
  const keyFields = (matchedDocType?.requiredFields as string[]) ?? [];

  await Promise.all([
    validateRequiredFields(...),
    checkDuplicate(...),
  ]);
}
```

Replace the entire `if (classification.documentTypeId)` block with:

```ts
if (classification.documentTypeId) {
  const matchedDocType = cachedDocTypes?.find((dt) => dt.id === classification.documentTypeId);
  const keyFields = (matchedDocType?.requiredFields as string[]) ?? [];

  await Promise.all([
    validateRequiredFields(
      { name: matchedDocType?.name ?? ext.documentType, requiredFields: matchedDocType?.requiredFields },
      ext.fields,
      { trackedItemId }
    ),
    checkDuplicate(userId, classification.documentTypeId, keyFields, ext.fields, {
      trackedItemId,
    }),
  ]);
}

// Doc type mismatch check — runs regardless of whether classification succeeded
const expectedDocTypeId = item.scrapeSession.expectedDocumentTypeId;
if (expectedDocTypeId) {
  const expectedDocType = cachedDocTypes?.find((dt) => dt.id === expectedDocTypeId);
  if (expectedDocType) {
    await checkDocTypeMatch(
      classification.documentTypeId,
      classification.documentTypeName,
      expectedDocTypeId,
      expectedDocType.name,
      { trackedItemId }
    );
  }
}
```

> **Why after the existing block:** The `validateRequiredFields` + `checkDuplicate` only run when classification succeeds. Doc type mismatch should fire even when the PDF type was unrecognised (status → WARNING), so it goes unconditionally after.

- [ ] **Step 3: Verify compiles**

```bash
npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors in `item-detail-worker.ts`.

- [ ] **Step 4: Commit**

```bash
git add src/workers/item-detail-worker.ts
git commit -m "feat: persist DOC_TYPE_MATCH in worker"
```

---

## Task 4: Include `DOC_TYPE_MATCH` in the session items page FWA query

**Files:**
- Modify: `src/app/(dashboard)/portals/[id]/sessions/[sessionId]/page.tsx`

**Context:** Lines ~70–77 fetch `fwaResults` with a `ruleType: { in: [...] }` filter. `DOC_TYPE_MATCH` is not in that list.

- [ ] **Step 1: Add `DOC_TYPE_MATCH` to the ruleType filter**

Locate (lines ~72–75):
```ts
ruleType: { in: ["TAMPERING", "ANOMALY", "DUPLICATE", "DOCUMENT_METADATA", "VISUAL_FORENSICS", "ARITHMETIC_INCONSISTENCY"] },
```

Replace with:
```ts
ruleType: { in: ["TAMPERING", "ANOMALY", "DUPLICATE", "DOCUMENT_METADATA", "VISUAL_FORENSICS", "ARITHMETIC_INCONSISTENCY", "DOC_TYPE_MATCH"] },
```

- [ ] **Step 2: Add `DOC_TYPE_MATCH` to the priority map**

Locate (lines ~80–81):
```ts
const FWA_PRIORITY: Record<string, number> = { TAMPERING: 3, DUPLICATE: 2, ANOMALY: 1 };
```

Replace with:
```ts
const FWA_PRIORITY: Record<string, number> = { TAMPERING: 3, DUPLICATE: 2, ANOMALY: 1, DOC_TYPE_MATCH: 1 };
```

This gives DOC_TYPE_MATCH the same base priority as ANOMALY. A FAIL status still wins over a WARNING via the `+100` score multiplier in the existing logic.

- [ ] **Step 3: Verify compiles**

```bash
npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/\(dashboard\)/portals/\[id\]/sessions/\[sessionId\]/page.tsx
git commit -m "feat: include DOC_TYPE_MATCH in session items FWA query"
```

---

## Task 5: Show the badge in `TrackedItemsTable`

**Files:**
- Modify: `src/components/portals/tracked-items-table.tsx`

**Context:** `FWA_LABELS` maps rule type strings to display labels. The FWA column renders a badge using `FWA_LABELS[item.fwaAlert.ruleType]`. Adding an entry for `DOC_TYPE_MATCH` is all that's needed.

- [ ] **Step 1: Add the label**

Locate (lines ~42–50):
```ts
const FWA_LABELS: Record<string, string> = {
  TAMPERING: "Tampering",
  ANOMALY: "Anomaly",
  DUPLICATE: "Duplicate",
  DOCUMENT_METADATA: "Metadata",
  VISUAL_FORENSICS: "Forgery",
  ARITHMETIC_INCONSISTENCY: "Math Error",
};
```

Replace with:
```ts
const FWA_LABELS: Record<string, string> = {
  TAMPERING: "Tampering",
  ANOMALY: "Anomaly",
  DUPLICATE: "Duplicate",
  DOCUMENT_METADATA: "Metadata",
  VISUAL_FORENSICS: "Forgery",
  ARITHMETIC_INCONSISTENCY: "Math Error",
  DOC_TYPE_MATCH: "Wrong Doc Type",
};
```

- [ ] **Step 2: Verify the badge renders correctly for both FAIL and WARNING**

The existing badge rendering code already handles `FAIL` vs non-FAIL via:
```ts
item.fwaAlert.status === "FAIL"
  ? "bg-status-error/10 text-status-error"
  : "bg-amber-500/10 text-amber-500"
```

- FAIL (classified type doesn't match expected) → red badge "Wrong Doc Type"
- WARNING (could not classify type) → amber badge "Wrong Doc Type"

No code change needed — the existing logic handles both correctly.

- [ ] **Step 3: Verify compiles**

```bash
npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/portals/tracked-items-table.tsx
git commit -m "feat: show Wrong Doc Type badge in items table"
```

---

## Task 6: Manual verification

- [ ] **Step 1: Start dev server**

```bash
npm run dev
```

- [ ] **Step 2: Create or use a portal that has a `defaultDocumentTypeId` set**

Verify: Portal detail page → Document Type card shows a type name.

- [ ] **Step 3: Run a scrape session for that portal**

When creating the session, the modal pre-selects the default doc type. The session gets `expectedDocumentTypeId` set.

- [ ] **Step 4: Open the session items page**

After items are processed, check:
- If any item's PDF was classified as a different type → red "Wrong Doc Type" badge appears in FWA column
- Hovering the badge shows the tooltip: "Wrong document type: got '...', expected '...'"
- If any item's PDF type was unrecognised → amber "Wrong Doc Type" badge

- [ ] **Step 5: Verify tooltip message is readable**

The message comes from `ValidationResult.message` field, stored as `item.fwaAlert.message` on the `TableItem`. The Tooltip renders this via `content={item.fwaAlert.message}`.

- [ ] **Step 6: Verify no badge appears when portal has no expected doc type**

For a portal with no `defaultDocumentTypeId` set, sessions have `expectedDocumentTypeId = null`. The worker skips the check. No `DOC_TYPE_MATCH` records are written. No badge shows.

---

## Self-Review Checklist

**Spec coverage:**
- ✅ Flag items where auto-classified type ≠ expected → `checkDocTypeMatch()` writes FAIL
- ✅ Flag items where type is unrecognised → writes WARNING
- ✅ Visible badge in items table → FWA column shows "Wrong Doc Type"
- ✅ Tooltip explains the mismatch → message from ValidationResult
- ✅ No badge when no expected type configured → worker guard `if (expectedDocTypeId)`
- ✅ No duplicate ValidationResult records for matching types → only written when mismatch or unknown

**Placeholder scan:** None found.

**Type consistency:**
- `checkDocTypeMatch` parameters match at call site in worker
- `DOC_TYPE_MATCH` string matches the `ValidationCheck.ruleType` union in validator.ts
- No new Prisma model fields needed — `ValidationResult.ruleType` is already `String` in the schema
