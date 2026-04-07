import { SessionCard } from "./session-card";

interface SessionListProps {
  sessions: Array<{
    id: string;
    title: string;
    description: string | null;
    status: string;
    currentStep: string;
    createdAt: Date;
    updatedAt: Date;
  }>;
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
