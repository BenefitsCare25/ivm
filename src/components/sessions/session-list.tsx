import { SessionCard } from "./session-card";
import type { SessionDetailSummary } from "@/types/session";

interface SessionListProps {
  sessions: SessionDetailSummary[];
}

export function SessionList({ sessions }: SessionListProps) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {sessions.map((session) => (
        <SessionCard key={session.id} session={session} />
      ))}
    </div>
  );
}
