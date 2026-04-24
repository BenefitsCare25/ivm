import { Globe, FileText, FileType, AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { TargetFieldsTable } from "./target-fields-table";
import type { TargetAssetData } from "@/types/target";

interface TargetPreviewProps {
  target: TargetAssetData;
  onReplace: () => void;
}

const TYPE_ICONS = {
  WEBPAGE: Globe,
  PDF: FileText,
  DOCX: FileType,
} as const;

export function TargetPreview({ target, onReplace }: TargetPreviewProps) {
  const Icon = TYPE_ICONS[target.targetType];

  return (
    <div className="space-y-4">
      <Card className="flex items-start justify-between p-4">
        <div className="flex items-center gap-3">
          <Icon className="h-6 w-6 text-muted-foreground" />
          <div>
            <div className="flex items-center gap-2">
              <Badge variant="secondary">{target.targetType}</Badge>
              <span className="text-sm text-muted-foreground">
                {target.fieldCount} field{target.fieldCount !== 1 ? "s" : ""} detected
              </span>
            </div>
            <p className="mt-1 text-sm text-foreground">
              {target.url ?? target.fileName ?? "Unknown target"}
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={onReplace}>
          Replace
        </Button>
      </Card>

      {!target.isSupported && target.unsupportedReason && (
        <Card className="flex items-start gap-2 p-4">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
          <p className="text-sm text-muted-foreground">{target.unsupportedReason}</p>
        </Card>
      )}

      <TargetFieldsTable fields={target.detectedFields} />
    </div>
  );
}
