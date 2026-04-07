import { Upload } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";

export default function SourceStepPage() {
  return (
    <EmptyState
      icon={Upload}
      title="Upload Source Document"
      description="Upload a document, image, or screenshot to extract fields from. Supported formats: PDF, PNG, JPG, DOCX."
    />
  );
}
