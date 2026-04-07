import { PenTool } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";

export default function FillStepPage() {
  return (
    <EmptyState
      icon={PenTool}
      title="Fill Not Started"
      description="Review and accept field mappings first. The system will fill the target form with your approval."
    />
  );
}
