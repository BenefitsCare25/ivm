export const dynamic = "force-dynamic";

import Link from "next/link";
import { Plus, FileText } from "lucide-react";
import { requireAuth } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { SessionList } from "@/components/sessions/session-list";

export default async function DashboardPage() {
  const session = await requireAuth();

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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Auto Form</h1>
          <p className="text-sm text-muted-foreground">
            Manage your document-to-form mapping sessions
          </p>
        </div>
        <Button asChild>
          <Link href="/sessions/new">
            <Plus className="mr-2 h-4 w-4" />
            New Session
          </Link>
        </Button>
      </div>

      {enrichedSessions.length === 0 ? (
        <EmptyState
          icon={<FileText className="h-6 w-6 text-muted-foreground" />}
          title="No sessions yet"
          description="Create your first session to start mapping documents to forms."
          action={
            <Button asChild>
              <Link href="/sessions/new">
                <Plus className="mr-2 h-4 w-4" />
                Create Session
              </Link>
            </Button>
          }
        />
      ) : (
        <SessionList sessions={enrichedSessions} />
      )}
    </div>
  );
}
