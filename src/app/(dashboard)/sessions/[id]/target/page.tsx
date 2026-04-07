import { Target } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";

export default function TargetStepPage() {
  return (
    <EmptyState
      icon={Target}
      title="No Target Selected"
      description="Select where to fill the extracted data: a webpage, interactive PDF, or DOCX template."
    />
  );
}
