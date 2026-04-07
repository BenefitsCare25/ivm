import { ScanSearch } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";

export default function ExtractStepPage() {
  return (
    <EmptyState
      icon={ScanSearch}
      title="Extraction Not Started"
      description="Upload a source document first. AI will extract and identify fields automatically."
    />
  );
}
