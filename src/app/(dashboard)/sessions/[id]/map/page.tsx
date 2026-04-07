import { GitCompareArrows } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";

export default function MapStepPage() {
  return (
    <EmptyState
      icon={GitCompareArrows}
      title="Mapping Not Available"
      description="Complete source extraction and target selection first. AI will propose field mappings with rationale."
    />
  );
}
