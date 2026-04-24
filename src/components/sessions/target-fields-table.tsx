import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import type { TargetField } from "@/types/target";

interface TargetFieldsTableProps {
  fields: TargetField[];
}

export function TargetFieldsTable({ fields }: TargetFieldsTableProps) {
  if (fields.length === 0) {
    return (
      <Card className="p-4 text-center text-sm text-muted-foreground">
        No fillable fields detected in this target.
      </Card>
    );
  }

  return (
    <Card className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/50">
            <th className="px-4 py-2 text-left font-medium text-muted-foreground">Name</th>
            <th className="px-4 py-2 text-left font-medium text-muted-foreground">Label</th>
            <th className="px-4 py-2 text-left font-medium text-muted-foreground">Type</th>
            <th className="px-4 py-2 text-left font-medium text-muted-foreground">Required</th>
            <th className="px-4 py-2 text-left font-medium text-muted-foreground">Current Value</th>
          </tr>
        </thead>
        <tbody>
          {fields.map((field) => (
            <tr key={field.id} className="border-b border-border last:border-0">
              <td className="px-4 py-2 font-mono text-xs text-foreground">{field.name}</td>
              <td className="px-4 py-2 text-foreground">{field.label}</td>
              <td className="px-4 py-2">
                <Badge variant="secondary">{field.fieldType}</Badge>
              </td>
              <td className="px-4 py-2">
                {field.required ? (
                  <Badge variant="default">Yes</Badge>
                ) : (
                  <span className="text-muted-foreground">No</span>
                )}
              </td>
              <td className="px-4 py-2 text-muted-foreground">
                {field.currentValue || "-"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
