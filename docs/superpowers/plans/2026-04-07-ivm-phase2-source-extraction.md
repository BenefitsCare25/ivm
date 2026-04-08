# IVM Phase 2 — Source Ingestion & AI Extraction

**Date**: 2026-04-07
**Status**: Planning

---

## Context

Phase 1 delivered the production foundation: auth, DB schema, session CRUD, dashboard, and a step-based workflow shell with placeholder pages. Phase 2 replaces the SOURCE and EXTRACT placeholder pages with working file upload, AI-powered field extraction via Claude, and an extraction review/edit screen.

After Phase 2, a user can:
- Upload a source document (PDF, PNG, JPG, WEBP) via drag-and-drop or file picker
- See upload progress and file preview
- Trigger AI extraction (Claude API extracts structured fields)
- Review extracted fields in a table (label, value, type, confidence)
- Edit extracted field values inline
- Session advances: `CREATED → SOURCE_UPLOADED → EXTRACTED`, step `SOURCE → EXTRACT`

**DOCX note**: DOCX uploads are accepted (needed for Phase 3 targets) but extraction is not supported yet — Claude cannot natively parse DOCX binary. Will add a text extraction library in a future phase.

---

## Task Breakdown (8 tasks)

### Task 1: Install dependency + env vars
- `npm install @anthropic-ai/sdk`
- Uncomment `AI_PROVIDER` and `ANTHROPIC_API_KEY` in `.env.example`

### Task 2: Validation schemas
**New files:**
- `src/lib/validations/upload.ts` — ALLOWED_MIME_TYPES, MAX_FILE_SIZE (10MB), ALLOWED_EXTENSIONS map, `validateUploadFile()` function
- `src/lib/validations/extraction.ts` — Zod schema for editing extracted fields (`updateExtractionFieldsSchema`)

### Task 3: AI library
**New files:**
- `src/lib/ai/types.ts` — `AIExtractionRequest`, `AIExtractionResponse` interfaces
- `src/lib/ai/prompts.ts` — `getExtractionSystemPrompt()`, `getExtractionUserPrompt(fileName)` — instructs Claude to return JSON with `documentType` + `ExtractedField[]`
- `src/lib/ai/anthropic.ts` — `extractFieldsFromDocument(request)` function
  - Images (PNG/JPG/WebP): sent as base64 `image` content block
  - PDFs: sent as base64 `document` content block (Claude native PDF support)
  - DOCX: returns graceful error (not yet supported)
  - Model: `claude-sonnet-4-20250514`, max_tokens 4096, 60s timeout
  - Parses JSON from response, strips markdown code fences if present
  - Generates UUIDs for field IDs

### Task 4: File serving route
**New file:** `src/app/api/files/[key]/route.ts`
- `GET /api/files/:key` — auth check, decode key, download via StorageAdapter, return with Content-Type header
- Required because `LocalStorageAdapter.getUrl()` returns `/api/files/{encoded-key}`

### Task 5: Upload API route
**New file:** `src/app/api/sessions/[id]/upload/route.ts`
- `POST /api/sessions/:id/upload` — multipart/form-data with `file` field
- Validates file type + size, generates storage key `sessions/{id}/sources/{timestamp}-{name}`
- Stores via `getStorageAdapter().upload()`, creates `SourceAsset` record
- If session already has a source asset: deletes old one (replace semantics — one source per session for Phase 2)
- Updates session: `status = SOURCE_UPLOADED`
- Creates audit event `SOURCE_UPLOADED`
- Returns 201 with SourceAsset data

### Task 6: Extraction API routes
**New files:**
- `src/app/api/sessions/[id]/extract/route.ts`
  - `POST /api/sessions/:id/extract` — triggers AI extraction synchronously
  - Creates `ExtractionResult` (PENDING → PROCESSING), downloads source file, calls `extractFieldsFromDocument()`
  - On success: status COMPLETED, updates session to `EXTRACTED` + `currentStep = EXTRACT`
  - On failure: status FAILED with error message
  - Returns extraction result

- `src/app/api/sessions/[id]/extraction/route.ts`
  - `GET /api/sessions/:id/extraction` — returns latest ExtractionResult or null

- `src/app/api/sessions/[id]/extraction/[extractionId]/route.ts`
  - `PATCH /api/sessions/:id/extraction/:extractionId` — updates fields (user edits), validates with Zod schema

### Task 7: UI components
**New files:**
- `src/components/sessions/source-upload.tsx` (~200 lines)
  - Client component: drag-and-drop zone + file picker, upload progress (XHR for real progress), error display
  - Props: `sessionId`, `existingAsset?`, `onUploadComplete`

- `src/components/sessions/source-preview.tsx` (~80 lines)
  - Displays uploaded file: image preview (via `/api/files/...`), or file icon for PDF/DOCX
  - Shows metadata: name, size, type
  - "Replace" button

- `src/components/sessions/extraction-status.tsx` (~60 lines)
  - Status indicator: idle / processing (spinner) / completed (success badge) / failed (error + retry)

- `src/components/sessions/extraction-table.tsx` (~250 lines)
  - Table: Label, Value, Type (Badge), Confidence (color-coded Badge)
  - Inline editing: click value → Input, blur/Enter → save locally
  - "Save Changes" button calls PATCH API
  - Props: `fields`, `onFieldsChange`, `readOnly?`

### Task 8: Update step pages
**Modified files:**
- `src/app/(dashboard)/sessions/[id]/source/page.tsx` — server component fetches sourceAssets, passes to client wrapper
- `src/app/(dashboard)/sessions/[id]/extract/page.tsx` — server component fetches extractionResults + sourceAssets, passes to client wrapper

**New files:**
- `src/components/sessions/source-step-client.tsx` (~80 lines)
  - Manages upload/preview toggle, calls `router.refresh()` after upload

- `src/components/sessions/extract-step-client.tsx` (~150 lines)
  - "Extract Fields" button → POST /extract → loading state → results table
  - Save edits → PATCH /extraction/:id
  - "Continue to Target" button → navigate to next step

---

## Dependency Graph

```
Task 1 (npm install)
  ├── Task 2 (validation) ──┬── Task 5 (upload route) ──┐
  └── Task 3 (AI library) ──┤                            ├── Task 6 (extraction routes)
                             └── Task 4 (file serving)───┘         │
                                                                    v
                                                           Task 7 (UI components)
                                                                    │
                                                                    v
                                                           Task 8 (page updates)
```

Parallelizable: Tasks 2+3 together, Tasks 4+5 together.

---

## File Manifest

**New (16 files):**
| File | Purpose | ~Lines |
|------|---------|--------|
| `src/lib/validations/upload.ts` | File validation constants + function | 40 |
| `src/lib/validations/extraction.ts` | Zod schema for field edits | 30 |
| `src/lib/ai/types.ts` | AI request/response interfaces | 20 |
| `src/lib/ai/prompts.ts` | Extraction prompt templates | 60 |
| `src/lib/ai/anthropic.ts` | Anthropic client + extraction function | 120 |
| `src/app/api/files/[key]/route.ts` | File serving endpoint | 40 |
| `src/app/api/sessions/[id]/upload/route.ts` | File upload endpoint | 80 |
| `src/app/api/sessions/[id]/extract/route.ts` | Extraction trigger endpoint | 90 |
| `src/app/api/sessions/[id]/extraction/route.ts` | Get extraction results | 40 |
| `src/app/api/sessions/[id]/extraction/[extractionId]/route.ts` | Edit extraction fields | 50 |
| `src/components/sessions/source-upload.tsx` | Drag-and-drop upload component | 200 |
| `src/components/sessions/source-preview.tsx` | File preview component | 80 |
| `src/components/sessions/extraction-status.tsx` | Extraction status indicator | 60 |
| `src/components/sessions/extraction-table.tsx` | Extraction review table | 250 |
| `src/components/sessions/source-step-client.tsx` | Source step client wrapper | 80 |
| `src/components/sessions/extract-step-client.tsx` | Extract step client wrapper | 150 |

**Modified (3 files):**
| File | Change |
|------|--------|
| `.env.example` | Uncomment AI vars |
| `src/app/(dashboard)/sessions/[id]/source/page.tsx` | Replace EmptyState with data fetch + client wrapper |
| `src/app/(dashboard)/sessions/[id]/extract/page.tsx` | Replace EmptyState with data fetch + client wrapper |

---

## Key Reusable Patterns

| Pattern | Source | Reuse In |
|---------|--------|----------|
| `errorResponse(err)` | `src/lib/errors.ts` | All new API routes |
| `requireAuth()` / `requireAuthApi()` | `src/lib/auth-helpers.ts` | Pages / API routes |
| `getStorageAdapter()` | `src/lib/storage/index.ts` | Upload + extract routes |
| `db.auditEvent.create()` | Existing pattern in session routes | All state transitions |
| `cn()` | `src/lib/utils.ts` | All new components |
| Badge, Card, Button, Input, FormError | `src/components/ui/*` | All new components |
| `updateMany` with ownership WHERE | `src/app/api/sessions/[id]/route.ts` | PATCH extraction route |

---

## Session Status Transitions

| Event | Status | currentStep |
|-------|--------|-------------|
| File uploaded | `CREATED → SOURCE_UPLOADED` | stays `SOURCE` |
| Extraction completed | `SOURCE_UPLOADED → EXTRACTED` | `SOURCE → EXTRACT` |
| Re-upload (replace) | reset to `SOURCE_UPLOADED` | stays `SOURCE` |
| Extraction failed | no change | no change |

---

## Verification

1. Create session → go to Source step → drag PDF → verify progress → verify preview → check DB `SourceAsset` + session `status = SOURCE_UPLOADED`
2. Upload image → verify preview loads via `/api/files/...` endpoint
3. Go to Extract step → click "Extract Fields" → verify spinner → fields appear in table → check DB `ExtractionResult` + session `status = EXTRACTED`
4. Click a field value → edit inline → "Save Changes" → refresh page → verify edits persisted
5. Upload .txt → verify 400 rejection. Upload 11MB → verify 400 rejection. Extract without source → verify 400.
6. Replace source → verify old asset deleted, session status reset
7. Stepper reflects correct step throughout
