# Phase 6: Review UX, History & Audit — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enhance the review step with a session activity timeline, audit event API, session metadata summary, tabbed layout (Results / History), and session export — giving users transparency into what happened, when, and by whom.

**Architecture:** No schema changes needed — `AuditEvent` model already captures all events. New API route to query audit events. Review step gets a tabbed layout: "Results" tab (existing fill report + actions table) and "History" tab (timeline of audit events). Dashboard session cards get richer metadata (source file, target type, field counts). Session detail page gets a metadata sidebar. JSON export endpoint for compliance.

**Tech Stack:** Next.js App Router, Prisma (existing schema), Radix UI Tabs, Lucide icons

---

## File Structure

### New Files (8)

| File | Responsibility |
|------|---------------|
| `src/types/audit.ts` | AuditEvent types, event labels, display helpers |
| `src/app/api/sessions/[id]/audit-events/route.ts` | GET audit events with optional filters |
| `src/app/api/sessions/[id]/export/route.ts` | GET full session export as JSON |
| `src/components/sessions/session-timeline.tsx` | Visual timeline of audit events |
| `src/components/sessions/session-metadata.tsx` | Session metadata summary card |
| `src/components/sessions/review-tabs.tsx` | Tabbed container (Results / History) for review step |
| `src/components/sessions/session-detail-card.tsx` | Enhanced card for dashboard with metadata |
| `src/lib/validations/audit.ts` | Zod schema for audit event query params |

### Modified Files (5)

| File | Change |
|------|--------|
| `src/app/(dashboard)/sessions/[id]/review/page.tsx` | Fetch audit events + metadata, pass to tabbed layout |
| `src/components/sessions/review-step-client.tsx` | Wrap in ReviewTabs, add History tab content |
| `src/app/(dashboard)/page.tsx` | Fetch richer session data (source name, target type, field counts) |
| `src/components/sessions/session-card.tsx` | Display source file, target type, field count |
| `src/types/session.ts` | Add `SessionDetailSummary` with metadata fields |

---

## Task 1: Audit Event Types & Helpers

**Files:**
- Create: `src/types/audit.ts`

- [ ] **Step 1: Create audit event types and display helpers**

```typescript
// src/types/audit.ts

export interface AuditEventSummary {
  id: string;
  eventType: string;
  actor: string;
  timestamp: string;
  payload: Record<string, unknown>;
}

export const EVENT_LABELS: Record<string, string> = {
  SESSION_CREATED: "Session created",
  SOURCE_UPLOADED: "Source document uploaded",
  EXTRACTION_STARTED: "AI extraction started",
  EXTRACTION_COMPLETED: "AI extraction completed",
  EXTRACTION_FAILED: "AI extraction failed",
  EXTRACTION_FIELD_EDITED: "Extracted field edited",
  TARGET_SELECTED: "Target selected",
  TARGET_DELETED: "Target removed",
  MAPPING_PROPOSED: "AI mapping proposed",
  MAPPING_REVIEWED: "Mapping reviewed",
  MAPPING_ACCEPTED: "Mapping accepted",
  FILL_EXECUTED: "Fill executed",
  SESSION_COMPLETED: "Session completed",
};

export const EVENT_ICONS: Record<string, string> = {
  SESSION_CREATED: "Plus",
  SOURCE_UPLOADED: "Upload",
  EXTRACTION_STARTED: "Loader",
  EXTRACTION_COMPLETED: "CheckCircle",
  EXTRACTION_FAILED: "XCircle",
  EXTRACTION_FIELD_EDITED: "Pencil",
  TARGET_SELECTED: "Target",
  TARGET_DELETED: "Trash2",
  MAPPING_PROPOSED: "GitBranch",
  MAPPING_REVIEWED: "Eye",
  MAPPING_ACCEPTED: "ThumbsUp",
  FILL_EXECUTED: "Play",
  SESSION_COMPLETED: "CheckCircle2",
};

export function getEventLabel(eventType: string): string {
  return EVENT_LABELS[eventType] ?? eventType;
}

export function getEventIconName(eventType: string): string {
  return EVENT_ICONS[eventType] ?? "Circle";
}

export function formatPayloadSummary(eventType: string, payload: Record<string, unknown>): string | null {
  switch (eventType) {
    case "SOURCE_UPLOADED":
      return payload.fileName ? `File: ${payload.fileName}` : null;
    case "EXTRACTION_COMPLETED":
      return payload.fieldCount ? `${payload.fieldCount} fields extracted` : null;
    case "EXTRACTION_FIELD_EDITED":
      return payload.fieldLabel ? `Field: ${payload.fieldLabel}` : null;
    case "TARGET_SELECTED":
      return payload.targetType ? `Type: ${payload.targetType}` : null;
    case "MAPPING_PROPOSED":
      return payload.mappingCount ? `${payload.mappingCount} mappings` : null;
    case "FILL_EXECUTED":
      return payload.total ? `${payload.total} fields filled` : null;
    default:
      return null;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/types/audit.ts
git commit -m "feat: add audit event types"
```

---

## Task 2: Audit Event Validation & API Route

**Files:**
- Create: `src/lib/validations/audit.ts`
- Create: `src/app/api/sessions/[id]/audit-events/route.ts`

- [ ] **Step 1: Create Zod validation for audit query params**

```typescript
// src/lib/validations/audit.ts
import { z } from "zod";

export const auditQuerySchema = z.object({
  eventType: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
```

- [ ] **Step 2: Create audit events GET API route**

```typescript
// src/app/api/sessions/[id]/audit-events/route.ts
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { errorResponse, UnauthorizedError, NotFoundError } from "@/lib/errors";
import { auditQuerySchema } from "@/lib/validations/audit";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) throw new UnauthorizedError();

    const { id } = await params;

    const fillSession = await db.fillSession.findFirst({
      where: { id, userId: session.user.id },
      select: { id: true },
    });
    if (!fillSession) throw new NotFoundError("Session", id);

    const url = new URL(req.url);
    const query = auditQuerySchema.parse({
      eventType: url.searchParams.get("eventType") ?? undefined,
      limit: url.searchParams.get("limit") ?? undefined,
      offset: url.searchParams.get("offset") ?? undefined,
    });

    const where: Record<string, unknown> = { fillSessionId: id };
    if (query.eventType) where.eventType = query.eventType;

    const [events, total] = await Promise.all([
      db.auditEvent.findMany({
        where,
        orderBy: { timestamp: "asc" },
        take: query.limit,
        skip: query.offset,
      }),
      db.auditEvent.count({ where }),
    ]);

    return NextResponse.json({
      events: events.map((e) => ({
        id: e.id,
        eventType: e.eventType,
        actor: e.actor,
        timestamp: e.timestamp.toISOString(),
        payload: e.payload as Record<string, unknown>,
      })),
      total,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
```

- [ ] **Step 3: Verify route works**

Start dev server (`npm run dev`), create a session, and hit `GET /api/sessions/<id>/audit-events` — should return `SESSION_CREATED` event.

- [ ] **Step 4: Commit**

```bash
git add src/lib/validations/audit.ts src/app/api/sessions/[id]/audit-events/route.ts
git commit -m "feat: add audit events API"
```

---

## Task 3: Session Export API Route

**Files:**
- Create: `src/app/api/sessions/[id]/export/route.ts`

- [ ] **Step 1: Create session export GET route**

This route returns a full JSON snapshot of the session — metadata, extraction, mappings, fill actions, and audit log.

```typescript
// src/app/api/sessions/[id]/export/route.ts
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { errorResponse, UnauthorizedError, NotFoundError } from "@/lib/errors";

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
        sourceAssets: {
          select: { id: true, originalName: true, mimeType: true, sizeBytes: true, uploadedAt: true },
        },
        extractionResults: {
          select: { id: true, provider: true, documentType: true, fields: true, status: true, completedAt: true },
        },
        targetAssets: {
          select: { id: true, targetType: true, url: true, fileName: true, detectedFields: true, isSupported: true, inspectedAt: true },
        },
        mappingSets: {
          select: { id: true, status: true, mappings: true, proposedAt: true, reviewedAt: true },
        },
        fillActions: {
          select: { id: true, targetFieldId: true, intendedValue: true, appliedValue: true, verifiedValue: true, status: true, errorMessage: true, appliedAt: true, verifiedAt: true },
        },
        auditEvents: {
          orderBy: { timestamp: "asc" },
          select: { id: true, eventType: true, actor: true, payload: true, timestamp: true },
        },
      },
    });

    if (!fillSession) throw new NotFoundError("Session", id);

    const exportData = {
      exportedAt: new Date().toISOString(),
      session: {
        id: fillSession.id,
        title: fillSession.title,
        description: fillSession.description,
        status: fillSession.status,
        currentStep: fillSession.currentStep,
        createdAt: fillSession.createdAt.toISOString(),
        updatedAt: fillSession.updatedAt.toISOString(),
      },
      sourceAssets: fillSession.sourceAssets,
      extractionResults: fillSession.extractionResults,
      targetAssets: fillSession.targetAssets,
      mappingSets: fillSession.mappingSets,
      fillActions: fillSession.fillActions,
      auditEvents: fillSession.auditEvents,
    };

    return new NextResponse(JSON.stringify(exportData, null, 2), {
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="session-${id}-export.json"`,
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/sessions/[id]/export/route.ts
git commit -m "feat: add session export API"
```

---

## Task 4: Session Timeline Component

**Files:**
- Create: `src/components/sessions/session-timeline.tsx`

- [ ] **Step 1: Create the session timeline component**

This renders a vertical timeline of audit events with icons, labels, timestamps, and optional payload summaries.

```typescript
// src/components/sessions/session-timeline.tsx
"use client";

import {
  Plus, Upload, Loader, CheckCircle, XCircle, Pencil, Target,
  Trash2, GitBranch, Eye, ThumbsUp, Play, CheckCircle2, Circle,
} from "lucide-react";
import { formatDate } from "@/lib/utils";
import { getEventLabel, formatPayloadSummary } from "@/types/audit";
import type { AuditEventSummary } from "@/types/audit";

const ICON_MAP: Record<string, React.ElementType> = {
  Plus, Upload, Loader, CheckCircle, XCircle, Pencil, Target,
  Trash2, GitBranch, Eye, ThumbsUp, Play, CheckCircle2, Circle,
};

interface SessionTimelineProps {
  events: AuditEventSummary[];
}

function getIconComponent(eventType: string): React.ElementType {
  const iconNames: Record<string, string> = {
    SESSION_CREATED: "Plus",
    SOURCE_UPLOADED: "Upload",
    EXTRACTION_STARTED: "Loader",
    EXTRACTION_COMPLETED: "CheckCircle",
    EXTRACTION_FAILED: "XCircle",
    EXTRACTION_FIELD_EDITED: "Pencil",
    TARGET_SELECTED: "Target",
    TARGET_DELETED: "Trash2",
    MAPPING_PROPOSED: "GitBranch",
    MAPPING_REVIEWED: "Eye",
    MAPPING_ACCEPTED: "ThumbsUp",
    FILL_EXECUTED: "Play",
    SESSION_COMPLETED: "CheckCircle2",
  };
  return ICON_MAP[iconNames[eventType] ?? "Circle"] ?? Circle;
}

function getEventColor(eventType: string): string {
  if (eventType.includes("FAILED")) return "text-red-500 bg-red-500/10";
  if (eventType.includes("COMPLETED") || eventType === "SESSION_COMPLETED" || eventType === "MAPPING_ACCEPTED")
    return "text-emerald-500 bg-emerald-500/10";
  if (eventType.includes("STARTED") || eventType === "FILL_EXECUTED")
    return "text-sky-500 bg-sky-500/10";
  if (eventType.includes("EDITED") || eventType.includes("REVIEWED") || eventType.includes("DELETED"))
    return "text-amber-500 bg-amber-500/10";
  return "text-muted-foreground bg-muted";
}

export function SessionTimeline({ events }: SessionTimelineProps) {
  if (events.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No activity recorded yet.
      </p>
    );
  }

  return (
    <div className="relative space-y-0">
      {/* Vertical line */}
      <div className="absolute left-4 top-3 bottom-3 w-px bg-border" />

      {events.map((event, idx) => {
        const Icon = getIconComponent(event.eventType);
        const colorClass = getEventColor(event.eventType);
        const summary = formatPayloadSummary(event.eventType, event.payload);

        return (
          <div key={event.id} className="relative flex items-start gap-4 py-3">
            {/* Icon dot */}
            <div
              className={`relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${colorClass}`}
            >
              <Icon className="h-4 w-4" />
            </div>

            {/* Content */}
            <div className="min-w-0 flex-1 pt-0.5">
              <p className="text-sm font-medium text-foreground">
                {getEventLabel(event.eventType)}
              </p>
              {summary && (
                <p className="text-xs text-muted-foreground">{summary}</p>
              )}
              <p className="mt-0.5 text-xs text-muted-foreground/60">
                {formatDate(event.timestamp)}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/sessions/session-timeline.tsx
git commit -m "feat: add session timeline component"
```

---

## Task 5: Session Metadata Component

**Files:**
- Create: `src/components/sessions/session-metadata.tsx`

- [ ] **Step 1: Create session metadata card**

Displays key session facts: source file, target type, AI provider, extraction count, fill stats, timestamps.

```typescript
// src/components/sessions/session-metadata.tsx
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";

export interface SessionMetadataProps {
  sourceFileName: string | null;
  sourceMimeType: string | null;
  targetType: string | null;
  targetName: string | null;
  aiProvider: string | null;
  extractedFieldCount: number;
  mappedFieldCount: number;
  fillTotal: number;
  fillVerified: number;
  fillFailed: number;
  createdAt: string;
  updatedAt: string;
  status: string;
}

const metaRow = (label: string, value: React.ReactNode) => (
  <div className="flex items-center justify-between py-1.5">
    <span className="text-xs text-muted-foreground">{label}</span>
    <span className="text-xs font-medium text-foreground">{value}</span>
  </div>
);

export function SessionMetadata(props: SessionMetadataProps) {
  return (
    <Card>
      <CardContent className="py-4 space-y-0 divide-y divide-border">
        {metaRow("Status", <Badge variant="secondary">{props.status}</Badge>)}
        {props.sourceFileName && metaRow("Source", props.sourceFileName)}
        {props.sourceMimeType && metaRow("Source Type", props.sourceMimeType)}
        {props.targetType && metaRow("Target Type", props.targetType)}
        {props.targetName && metaRow("Target", props.targetName)}
        {props.aiProvider && metaRow("AI Provider", props.aiProvider)}
        {metaRow("Extracted Fields", props.extractedFieldCount)}
        {metaRow("Mapped Fields", props.mappedFieldCount)}
        {props.fillTotal > 0 && metaRow("Fill Actions", `${props.fillVerified}/${props.fillTotal} verified`)}
        {props.fillFailed > 0 && metaRow("Fill Failures", <span className="text-red-500">{props.fillFailed}</span>)}
        {metaRow("Created", formatDate(props.createdAt))}
        {metaRow("Last Updated", formatDate(props.updatedAt))}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/sessions/session-metadata.tsx
git commit -m "feat: add session metadata card"
```

---

## Task 6: Review Tabs Component

**Files:**
- Create: `src/components/sessions/review-tabs.tsx`

- [ ] **Step 1: Create the tabbed review container**

Uses a simple tab state (no Radix Tabs needed — lightweight inline tabs).

```typescript
// src/components/sessions/review-tabs.tsx
"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

interface ReviewTabsProps {
  resultsContent: React.ReactNode;
  historyContent: React.ReactNode;
}

const TABS = [
  { id: "results", label: "Results" },
  { id: "history", label: "History" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export function ReviewTabs({ resultsContent, historyContent }: ReviewTabsProps) {
  const [activeTab, setActiveTab] = useState<TabId>("results");

  return (
    <div>
      <div className="flex gap-1 border-b border-border mb-6">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "px-4 py-2 text-sm font-medium transition-colors",
              activeTab === tab.id
                ? "border-b-2 border-foreground text-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "results" && resultsContent}
      {activeTab === "history" && historyContent}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/sessions/review-tabs.tsx
git commit -m "feat: add review tabs component"
```

---

## Task 7: Extend Session Types for Dashboard Metadata

**Files:**
- Modify: `src/types/session.ts`

- [ ] **Step 1: Add `SessionDetailSummary` type**

Add to the end of `src/types/session.ts`:

```typescript
export interface SessionDetailSummary extends SessionSummary {
  sourceFileName: string | null;
  sourceMimeType: string | null;
  targetType: string | null;
  targetName: string | null;
  extractedFieldCount: number;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/types/session.ts
git commit -m "feat: add SessionDetailSummary type"
```

---

## Task 8: Enhance Dashboard with Session Metadata

**Files:**
- Modify: `src/app/(dashboard)/page.tsx`
- Modify: `src/components/sessions/session-card.tsx`

- [ ] **Step 1: Update dashboard query to fetch metadata**

In `src/app/(dashboard)/page.tsx`, replace the existing `db.fillSession.findMany` call:

```typescript
const sessions = await db.fillSession.findMany({
  where: { userId: session.user.id },
  orderBy: { updatedAt: "desc" },
  select: {
    id: true,
    title: true,
    description: true,
    status: true,
    currentStep: true,
    createdAt: true,
    updatedAt: true,
    sourceAssets: {
      orderBy: { uploadedAt: "desc" },
      take: 1,
      select: { originalName: true, mimeType: true },
    },
    targetAssets: {
      orderBy: { inspectedAt: "desc" },
      take: 1,
      select: { targetType: true, url: true, fileName: true },
    },
    extractionResults: {
      where: { status: "COMPLETED" },
      take: 1,
      select: { fields: true },
    },
  },
});

const enrichedSessions = sessions.map((s) => {
  const source = s.sourceAssets[0] ?? null;
  const target = s.targetAssets[0] ?? null;
  const extraction = s.extractionResults[0] ?? null;
  const fields = extraction?.fields;
  return {
    id: s.id,
    title: s.title,
    description: s.description,
    status: s.status,
    currentStep: s.currentStep,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    sourceFileName: source?.originalName ?? null,
    sourceMimeType: source?.mimeType ?? null,
    targetType: target?.targetType ?? null,
    targetName: target?.url ?? target?.fileName ?? null,
    extractedFieldCount: Array.isArray(fields) ? fields.length : 0,
  };
});
```

Update the JSX to pass `enrichedSessions` to `SessionList`:

```tsx
<SessionList sessions={enrichedSessions} />
```

- [ ] **Step 2: Update SessionList to accept `SessionDetailSummary`**

In `src/components/sessions/session-list.tsx`, update the import and prop type:

```typescript
import type { SessionDetailSummary } from "@/types/session";

interface SessionListProps {
  sessions: SessionDetailSummary[];
}
```

And update the mapped component:

```tsx
<SessionCard key={session.id} session={session} />
```

- [ ] **Step 3: Update SessionCard to show metadata**

In `src/components/sessions/session-card.tsx`, update the import and interface:

```typescript
import { ArrowRight, FileText, Globe, FileSpreadsheet } from "lucide-react";
import type { SessionDetailSummary } from "@/types/session";

interface SessionCardProps {
  session: SessionDetailSummary;
}
```

Replace the `CardContent` section with:

```tsx
<CardContent>
  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
    <span>Step: {STEP_LABELS[session.currentStep as SessionStep]}</span>
    {session.sourceFileName && (
      <span className="truncate max-w-[150px]" title={session.sourceFileName}>
        {session.sourceFileName}
      </span>
    )}
    {session.targetType && (
      <span>{session.targetType}</span>
    )}
    {session.extractedFieldCount > 0 && (
      <span>{session.extractedFieldCount} fields</span>
    )}
    <span>Updated {formatDate(session.updatedAt)}</span>
  </div>
</CardContent>
```

- [ ] **Step 4: Run type check**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add src/app/(dashboard)/page.tsx src/components/sessions/session-list.tsx src/components/sessions/session-card.tsx
git commit -m "feat: enrich dashboard session cards"
```

---

## Task 9: Enhanced Review Step — Wire Everything Together

**Files:**
- Modify: `src/app/(dashboard)/sessions/[id]/review/page.tsx`
- Modify: `src/components/sessions/review-step-client.tsx`

- [ ] **Step 1: Update review page server component to fetch audit events and metadata**

Replace the entire contents of `src/app/(dashboard)/sessions/[id]/review/page.tsx`:

```typescript
export const dynamic = "force-dynamic";

import { requireAuth } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { notFound } from "next/navigation";
import { ReviewStepClient } from "@/components/sessions/review-step-client";
import { buildFillReport, toFillActionSummary } from "@/types/fill";
import type { FieldMapping } from "@/types/mapping";
import type { TargetField, TargetType } from "@/types/target";
import type { FillSessionData } from "@/types/fill";
import type { AuditEventSummary } from "@/types/audit";
import type { SessionMetadataProps } from "@/components/sessions/session-metadata";

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
      sourceAssets: { orderBy: { uploadedAt: "desc" }, take: 1 },
      extractionResults: { where: { status: "COMPLETED" }, take: 1 },
      targetAssets: { orderBy: { inspectedAt: "desc" }, take: 1 },
      mappingSets: {
        where: { status: "ACCEPTED" },
        orderBy: { reviewedAt: "desc" },
        take: 1,
      },
      fillActions: true,
      auditEvents: { orderBy: { timestamp: "asc" } },
    },
  });

  if (!fillSession) notFound();

  const sourceAsset = fillSession.sourceAssets[0] ?? null;
  const extraction = fillSession.extractionResults[0] ?? null;
  const targetAsset = fillSession.targetAssets[0] ?? null;
  const mappingSet = fillSession.mappingSets[0] ?? null;
  const hasFillActions = fillSession.fillActions.length > 0;

  // Build fill data
  let fillData: FillSessionData | null = null;
  if (hasFillActions) {
    const mappings = mappingSet
      ? (mappingSet.mappings as unknown as FieldMapping[])
      : [];
    const targetFields = targetAsset
      ? (targetAsset.detectedFields as unknown as TargetField[])
      : [];
    const actions = fillSession.fillActions.map((fa) =>
      toFillActionSummary(fa, targetFields, mappings)
    );
    fillData = {
      actions,
      report: buildFillReport(actions),
      hasFilledDocument: !!targetAsset?.filledStoragePath,
      webpageFillScript: null,
    };
  }

  // Build audit events
  const auditEvents: AuditEventSummary[] = fillSession.auditEvents.map((e) => ({
    id: e.id,
    eventType: e.eventType,
    actor: e.actor,
    timestamp: e.timestamp.toISOString(),
    payload: e.payload as Record<string, unknown>,
  }));

  // Build metadata
  const extractedFields = extraction?.fields;
  const mappings = mappingSet ? (mappingSet.mappings as unknown as FieldMapping[]) : [];
  const metadata: SessionMetadataProps = {
    sourceFileName: sourceAsset?.originalName ?? null,
    sourceMimeType: sourceAsset?.mimeType ?? null,
    targetType: targetAsset?.targetType ?? null,
    targetName: targetAsset?.url ?? targetAsset?.fileName ?? null,
    aiProvider: extraction?.provider ?? null,
    extractedFieldCount: Array.isArray(extractedFields) ? extractedFields.length : 0,
    mappedFieldCount: mappings.filter((m) => m.sourceFieldId !== null).length,
    fillTotal: fillData?.report.total ?? 0,
    fillVerified: fillData?.report.verified ?? 0,
    fillFailed: fillData?.report.failed ?? 0,
    createdAt: fillSession.createdAt.toISOString(),
    updatedAt: fillSession.updatedAt.toISOString(),
    status: fillSession.status,
  };

  return (
    <ReviewStepClient
      sessionId={id}
      hasPrerequisites={hasFillActions}
      targetType={(targetAsset?.targetType as TargetType) ?? null}
      sessionStatus={fillSession.status}
      fillData={fillData}
      auditEvents={auditEvents}
      metadata={metadata}
    />
  );
}
```

- [ ] **Step 2: Update ReviewStepClient to use tabs, timeline, and metadata**

Replace the entire contents of `src/components/sessions/review-step-client.tsx`:

```typescript
"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle, Download, FileDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/form-error";
import { FillReportCard } from "./fill-report-card";
import { FillActionsTable } from "./fill-actions-table";
import { ReviewTabs } from "./review-tabs";
import { SessionTimeline } from "./session-timeline";
import { SessionMetadata } from "./session-metadata";
import type { SessionMetadataProps } from "./session-metadata";
import { useDownloadFill } from "./use-download-fill";
import type { FillSessionData } from "@/types/fill";
import type { TargetType } from "@/types/target";
import type { AuditEventSummary } from "@/types/audit";

interface ReviewStepClientProps {
  sessionId: string;
  hasPrerequisites: boolean;
  targetType: TargetType | null;
  sessionStatus: string;
  fillData: FillSessionData | null;
  auditEvents: AuditEventSummary[];
  metadata: SessionMetadataProps;
}

export function ReviewStepClient({
  sessionId,
  hasPrerequisites,
  targetType,
  sessionStatus,
  fillData,
  auditEvents,
  metadata,
}: ReviewStepClientProps) {
  const router = useRouter();
  const handleDownload = useDownloadFill(sessionId);
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
      const message =
        err instanceof Error ? err.message : "Failed to complete session";
      setError(message);
    } finally {
      setCompleting(false);
    }
  }, [sessionId, router]);

  const handleExport = useCallback(async () => {
    const res = await fetch(`/api/sessions/${sessionId}/export`);
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `session-${sessionId}-export.json`;
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

  const resultsContent = (
    <div className="space-y-6">
      {completed && (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4 text-center">
          <CheckCircle className="mx-auto mb-2 h-8 w-8 text-emerald-500" />
          <p className="text-sm font-medium text-foreground">
            Session Completed
          </p>
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
              Download
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={handleExport}>
            <FileDown className="mr-2 h-4 w-4" />
            Export JSON
          </Button>
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

  const historyContent = (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="lg:col-span-2">
        <h3 className="mb-4 text-sm font-medium text-foreground">Activity</h3>
        <SessionTimeline events={auditEvents} />
      </div>
      <div>
        <h3 className="mb-4 text-sm font-medium text-foreground">Details</h3>
        <SessionMetadata {...metadata} />
      </div>
    </div>
  );

  return (
    <ReviewTabs
      resultsContent={resultsContent}
      historyContent={historyContent}
    />
  );
}
```

- [ ] **Step 3: Run type check**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/(dashboard)/sessions/[id]/review/page.tsx src/components/sessions/review-step-client.tsx
git commit -m "feat: add review tabs with history"
```

---

## Task 10: Verify & Build

**Files:** None (validation only)

- [ ] **Step 1: Run full type check**

```bash
npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 2: Run dev build**

```bash
npm run build
```

Expected: Successful build, no errors.

- [ ] **Step 3: Manual smoke test**

1. Start dev server: `npm run dev`
2. Log in as `dev@ivm.local / password123`
3. Open an existing completed session (or complete one through all steps)
4. Navigate to Review step
5. Verify "Results" tab shows fill report, actions table, download/export buttons
6. Verify "History" tab shows timeline of all audit events with icons and timestamps
7. Verify "History" tab shows metadata sidebar
8. Click "Export JSON" — verify JSON file downloads with all session data
9. Go to Dashboard — verify session cards show source file, target type, field count
10. Hit `GET /api/sessions/<id>/audit-events` directly — verify JSON response

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat: complete phase 6 review UX"
```

---

## Summary

| Task | What it does | New files | Modified files |
|------|-------------|-----------|----------------|
| 1 | Audit event types & helpers | `src/types/audit.ts` | — |
| 2 | Audit events API route | `src/lib/validations/audit.ts`, `src/app/api/.../audit-events/route.ts` | — |
| 3 | Session export API | `src/app/api/.../export/route.ts` | — |
| 4 | Session timeline component | `src/components/sessions/session-timeline.tsx` | — |
| 5 | Session metadata component | `src/components/sessions/session-metadata.tsx` | — |
| 6 | Review tabs component | `src/components/sessions/review-tabs.tsx` | — |
| 7 | Session types extension | — | `src/types/session.ts` |
| 8 | Enhanced dashboard cards | — | `page.tsx`, `session-card.tsx`, `session-list.tsx` |
| 9 | Wire review step together | — | `review/page.tsx`, `review-step-client.tsx` |
| 10 | Verify & build | — | — |

**No schema migrations needed** — all data already exists in `AuditEvent` model.
**No new dependencies** — uses existing Lucide, Radix UI, Prisma.
