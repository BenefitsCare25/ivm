import { PortalCard } from "./portal-card";
import type { PortalSummary } from "@/types/portal";

interface PortalListProps {
  portals: PortalSummary[];
}

export function PortalList({ portals }: PortalListProps) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {portals.map((portal) => (
        <PortalCard key={portal.id} portal={portal} />
      ))}
    </div>
  );
}
