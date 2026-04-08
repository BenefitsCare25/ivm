export const dynamic = "force-dynamic";

import { requireAuth } from "@/lib/auth-helpers";
import { CreateSessionForm } from "@/components/sessions/create-session-form";

export default async function CreateSessionPage() {
  await requireAuth();

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">New Session</h1>
        <p className="text-sm text-muted-foreground">
          Create a new document-to-form mapping session
        </p>
      </div>
      <CreateSessionForm />
    </div>
  );
}
