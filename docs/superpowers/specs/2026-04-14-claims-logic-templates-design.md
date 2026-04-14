# Claims Logic Templates — Design Spec

**Date**: 2026-04-14
**Status**: Approved
**Branch**: feature/portal-tracker

## Problem

Portal Tracker comparison templates currently only define which fields to compare and what match mode to use. Real-world claims processing requires three additional dimensions per claim type:

1. **Explicit field mappings** — document field names differ from portal field names (e.g., "Clinic Name" ↔ "Provider", "Invoice Date" ↔ "Incurred Date")
2. **Required documents** — different claim types require different document combinations (e.g., SP claims need Invoice + Referral Letter)
3. **Business rules** — conditional validation logic (e.g., "outstanding balance must be $0", "flag if CPF deduction exists but no CPF statement")

All three must be configurable per claim type in the UI and dynamically injected into the AI comparison prompt.

## Approach

- **AI-evaluated**: Business rules and required document checks are evaluated by the AI in the same call as field comparison — no coded rule engine. This allows adding/changing rules via UI without code changes.
- **Single AI call**: Field mappings, business rules, and required documents are combined into one prompt. The AI returns field comparisons + business rule results + document presence checks in one response.
- **Reuse existing models**: Business rule and required document results stored as `ValidationResult` records (existing model) with new `ruleType` values.

## Data Model Changes

### `ComparisonTemplate` — New JSON Columns

Add two JSON columns to the existing `ComparisonTemplate` model:

```prisma
model ComparisonTemplate {
  // ... existing fields ...
  requiredDocuments Json @default("[]")  // RequiredDocument[]
  businessRules     Json @default("[]")  // BusinessRule[]
}
```

### Expanded `TemplateField` Type

```typescript
export interface TemplateField {
  portalFieldName: string;      // field name on portal page (was: fieldName)
  documentFieldName: string;    // NEW — corresponding field name in document
  mode: MatchMode;              // "fuzzy" | "exact" | "numeric"
  tolerance?: number;           // for numeric mode
}
```

**Migration note**: Existing templates have `fieldName` (portal-side only). Migration sets `portalFieldName = fieldName` and `documentFieldName = fieldName` (same value as default — AI was previously inferring the mapping).

### New Types

```typescript
export interface RequiredDocument {
  documentTypeName: string;     // e.g., "Invoice", "Referral Letter"
  rule: "required" | "one_of";  // required = must be present; one_of = any in group
  group?: string;               // group name for one_of rules (e.g., "primary_doc")
}

export interface BusinessRule {
  id: string;                   // client-generated UUID for stable keys
  rule: string;                 // free-text natural language condition
  category: string;             // e.g., "Amount Validation", "Document Check"
  severity: "critical" | "warning" | "info";
}
```

### FWA Display Constants

Add to `FWA_RULE_TYPES` and `FWA_LABELS` in `src/types/portal.ts`:

```typescript
// Add to FWA_RULE_TYPES Set:
"BUSINESS_RULE", "REQUIRED_DOCUMENT"

// Add to FWA_LABELS Record:
BUSINESS_RULE: "Rule Violation",
REQUIRED_DOCUMENT: "Missing Document",
```

## AI Prompt Integration

### Combined Prompt Structure

A new `getFullComparisonPrompt()` function builds the combined prompt:

```
You are comparing a portal claim record against submitted documents.
You must perform three checks and return results for ALL of them.

## 1. Field Mappings (compare these pairs)
- Portal "Provider" ↔ Document "Clinic Name" — FUZZY match
- Portal "Invoice Number" ↔ Document "Invoice Number" — EXACT match
- Portal "Incurred Date" ↔ Document "Invoice Date" — FUZZY match
- Portal "Claimant" ↔ Document "Patient Name" — FUZZY match
- Portal "Receipt Amount" ↔ Document "Total Invoice Amount" — NUMERIC (tolerance: 0)

## 2. Business Rules (evaluate each against ALL available data)
1. [CRITICAL] Outstanding balance / Final Amount Payable must equal $0.00
2. [WARNING] If CPF deduction exists, check if CPF statement is provided
3. [WARNING] If medications/services listed but no line item breakdown, flag
4. [CRITICAL] Same date visit more than one time — flag duplicate

## 3. Required Documents (check presence in documents found)
- "Invoice" — REQUIRED
Documents found: ["Invoice"]

## Portal Page Fields
{ ...pageFields }

## PDF Extracted Fields
{ ...pdfFields }

Return a JSON object with this exact structure:
{
  "fieldComparisons": [...],
  "businessRuleResults": [
    {
      "rule": "the rule text",
      "category": "the category",
      "status": "PASS" | "FAIL" | "WARNING" | "NOT_APPLICABLE",
      "evidence": "specific data from the documents supporting this result",
      "notes": "optional explanation"
    }
  ],
  "requiredDocumentsCheck": [
    {
      "documentTypeName": "Invoice",
      "found": true,
      "notes": "Invoice detected as primary document"
    }
  ],
  "summary": "Brief narrative of key findings"
}
```

### Response Parsing

Expand `parseComparisonResponse()` to extract all three sections. `businessRuleResults` and `requiredDocumentsCheck` are optional in parsing (backward compatible with templates that have no rules/required docs).

### Prompt Preview

A shared utility function `buildPromptPreview(template)` generates the full prompt text with placeholder markers `{Portal Page Fields}` and `{PDF Extracted Fields}` instead of real data. Used by the frontend prompt preview card and reusable for debugging.

## Worker Integration

### Auto-Detection of Claim Type

A single scrape session can contain items of **mixed claim types** (e.g., Outpatient SG GP, Dental, SP in the same list). The system auto-detects the claim type per item using the existing `findMatchingTemplate()` mechanism — no user selection needed.

The portal's `groupingFields` (e.g., `["Claim Type"]`) identify which scraped field determines the claim type. Each item's scraped data is matched against template `groupingKey` values. For example:
- Item with `Claim Type: "Outpatient SG GP"` → matches template with `groupingKey: {"Claim Type": "Outpatient SG GP"}` → applies that template's field mappings, business rules, and required documents
- Item with `Claim Type: "SP"` → matches the SP template → different rules applied

This requires no changes — `findMatchingTemplate()` already works this way. The claim type field must be present in the portal's scraped data (always the case per confirmed requirement).

### `item-detail-worker.ts` Flow

```
extract files
  → find matching template
  → if template has businessRules or requiredDocuments:
      build combined prompt (field mappings + rules + required docs)
      → single AI call → parse expanded response
      → save ComparisonResult (fieldComparisons — unchanged)
      → save ValidationResult records:
          - one per businessRuleResult (ruleType: "BUSINESS_RULE")
          - one per requiredDocumentsCheck where found=false (ruleType: "REQUIRED_DOCUMENT")
    else:
      existing templated or full comparison (unchanged)
```

### ValidationResult Storage

**Business rule results:**

| Field | Value |
|---|---|
| `trackedItemId` | the item |
| `ruleType` | `"BUSINESS_RULE"` |
| `status` | Map AI status: `FAIL` → `"FAIL"`, `WARNING`/`NOT_APPLICABLE` → `"WARNING"`, `PASS` → `"PASS"` |
| `message` | `"{category}: {rule}"` |
| `metadata` | `{ rule, category, severity, evidence, notes, aiStatus }` |

**Required document results (failures only):**

| Field | Value |
|---|---|
| `ruleType` | `"REQUIRED_DOCUMENT"` |
| `status` | `"FAIL"` |
| `message` | `"Required document not found: {documentTypeName}"` |
| `metadata` | `{ documentTypeName, group?, notes }` |

### Recompare API

`POST .../recompare` expanded to:
1. Delete old `ValidationResult` records with `ruleType IN ('BUSINESS_RULE', 'REQUIRED_DOCUMENT')` for affected items
2. Re-run combined AI comparison with updated template
3. Save new `ComparisonResult` + `ValidationResult` records

## Frontend

### New Page: Template Detail (`/portals/[id]/templates/[templateId]`)

**Route**: `src/app/(dashboard)/portals/[id]/templates/[templateId]/page.tsx`

**Layout**: Back link + header + 4 card sections, each independently editable with auto-save on change.

#### Card 1: Field Mappings

Table with columns: Portal Field | Document Field | Mode | Actions

- **Add**: Inline row with two text inputs + mode dropdown (fuzzy/exact/numeric) + tolerance input (if numeric)
- **Edit**: Click row to edit inline
- **Delete**: ✕ button per row
- Auto-saves via PATCH on add/edit/delete

#### Card 2: Required Documents

List of document requirements with add/remove.

- **Add**: Select from existing `DocumentType` list + rule type radio (Required / One Of) + group name input (if One Of)
- **Delete**: ✕ button per row
- Helper text explaining Required vs One Of grouping

#### Card 3: Business Rules

Grouped by category with severity indicators.

- **Add**: Inline form — text input (rule) + category dropdown (predefined list + custom) + severity radio (Critical 🔴 / Warning 🟡 / Info 🔵)
- **Edit**: Click to edit inline
- **Delete**: ✕ button per rule
- **Predefined categories**: Amount Validation, Document Check, Line Item Check, Duplicate Detection, Compliance Check (+ allow custom text)

#### Card 4: AI Prompt Preview

- Read-only code block showing the full prompt that will be sent to the AI
- Auto-regenerates live as any card above changes
- Uses `buildPromptPreview(template)` utility
- Copy button to clipboard
- Note at bottom: "Portal/PDF data will be injected at runtime"

### Modified: ComparisonTemplateModal

Simplified to creation-only: name + grouping key fields. On save, redirects to the new template detail page for full configuration.

### Modified: Template List (Portal Detail Page)

Existing template list rows now link to `/portals/[id]/templates/[templateId]` instead of opening edit modal. Shows field count + rule count per template.

### Modified: TrackedItemsTable FWA Column

New `ruleType` values automatically render via existing `FWA_LABELS` mapping:
- `BUSINESS_RULE` with severity `critical` → red badge "Rule Violation"
- `BUSINESS_RULE` with severity `warning` → amber badge "Rule Warning"
- `REQUIRED_DOCUMENT` → red badge "Missing Document"
- Tooltip shows rule text + AI evidence

### Modified: Item Detail View

Business rule and required document validation results display in existing validation results section alongside Tampering, Duplicate, etc.

## API Routes

### New

- `GET /api/portals/[id]/templates/[templateId]` — fetch single template with all config
- `PATCH /api/portals/[id]/templates/[templateId]` — update template (fields, requiredDocuments, businessRules — partial updates supported)
- `GET /api/portals/[id]/templates/[templateId]/prompt-preview` — returns the full prompt text with placeholder data markers

### Modified

- `POST /api/portals/[id]/templates` — existing create, now returns `id` for redirect to detail page
- `POST .../recompare` — also clears/recreates `BUSINESS_RULE` + `REQUIRED_DOCUMENT` validation results

## Backward Compatibility

- Templates without `businessRules` or `requiredDocuments` (empty arrays) behave exactly as before — only field comparison runs, using `getTemplatedComparisonUserPrompt()` (existing function, updated to read `portalFieldName` instead of `fieldName`)
- Templates WITH `businessRules` or `requiredDocuments` use the new `getFullComparisonPrompt()` function
- Existing `TemplateField` with `fieldName` migrated to `portalFieldName` + `documentFieldName` (both set to old `fieldName` value). A data migration script updates all existing `ComparisonTemplate.fields` JSON in-place.
- Non-templated full AI comparison is completely unchanged
- All existing FWA alerts (Tampering, Duplicate, DOC_TYPE_MATCH, etc.) unaffected
- `getTemplatedComparisonUserPrompt()` is kept (updated to use `portalFieldName` + `documentFieldName` alias pairs) for templates without business rules. `getFullComparisonPrompt()` is only used when business rules or required documents are configured.

## File Organization

```
src/
  app/(dashboard)/portals/[id]/templates/[templateId]/
    page.tsx                          # Template detail page (server component)
  components/portals/
    template-detail-view.tsx          # Main client component for template detail
    template-field-mappings.tsx       # Card 1: field mapping table
    template-required-documents.tsx   # Card 2: required documents config
    template-business-rules.tsx       # Card 3: business rules config
    template-prompt-preview.tsx       # Card 4: live prompt preview
  lib/ai/
    prompts-comparison.ts             # Add getFullComparisonPrompt(), buildPromptPreview()
    comparison.ts                     # Expand response parsing
  types/
    portal.ts                         # Add RequiredDocument, BusinessRule types; update TemplateField
```
