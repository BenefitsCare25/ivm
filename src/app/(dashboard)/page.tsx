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
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Sessions</h1>
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

      {sessions.length === 0 ? (
        <EmptyState
          icon={FileText}
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
        <SessionList sessions={sessions} />
      )}
    </div>
  );
}
