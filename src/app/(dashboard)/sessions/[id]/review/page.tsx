import { CheckCircle } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";

export default function ReviewStepPage() {
  return (
    <EmptyState
      icon={CheckCircle}
      title="Review Not Available"
      description="Complete the fill step first. Review all applied values and verify accuracy before final submission."
    />
  );
}
