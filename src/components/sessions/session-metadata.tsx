import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";

export interface SessionMetadataProps {
  sourceFileName: string | null;
  sourceMimeType: string | null;
  targetType: string | null;
  targetName: string | null;
  aiProvider: string | null;
  extractedFieldCount: number;
  mappedFieldCount: number;
  fillTotal: number;
  fillVerified: number;
  fillFailed: number;
  createdAt: string;
  updatedAt: string;
  status: string;
}

function MetaRow({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-xs font-medium text-foreground" suppressHydrationWarning>{value}</span>
    </div>
  );
}

export function SessionMetadata(props: SessionMetadataProps) {
  return (
    <Card>
      <CardContent className="py-4 divide-y divide-border">
        <MetaRow
          label="Status"
          value={<Badge variant="secondary">{props.status}</Badge>}
        />
        {props.sourceFileName && (
          <MetaRow
            label="Source"
            value={
              <span
                className="max-w-[160px] truncate block text-right"
                title={props.sourceFileName}
              >
                {props.sourceFileName}
              </span>
            }
          />
        )}
        {props.sourceMimeType && (
          <MetaRow label="Source Type" value={props.sourceMimeType} />
        )}
        {props.targetType && (
          <MetaRow label="Target Type" value={props.targetType} />
        )}
        {props.targetName && (
          <MetaRow
            label="Target"
            value={
              <span
                className="max-w-[160px] truncate block text-right"
                title={props.targetName}
              >
                {props.targetName}
              </span>
            }
          />
        )}
        {props.aiProvider && (
          <MetaRow label="AI Provider" value={props.aiProvider} />
        )}
        <MetaRow label="Extracted Fields" value={props.extractedFieldCount} />
        <MetaRow label="Mapped Fields" value={props.mappedFieldCount} />
        {props.fillTotal > 0 && (
          <MetaRow
            label="Fill Actions"
            value={`${props.fillVerified}/${props.fillTotal} verified`}
          />
        )}
        {props.fillFailed > 0 && (
          <MetaRow
            label="Fill Failures"
            value={<span className="text-red-500">{props.fillFailed}</span>}
          />
        )}
        <MetaRow label="Created" value={formatDate(props.createdAt)} />
        <MetaRow label="Last Updated" value={formatDate(props.updatedAt)} />
      </CardContent>
    </Card>
  );
}
