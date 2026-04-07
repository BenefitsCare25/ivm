"use client";

import { useState, useCallback } from "react";
import { Pencil, Check, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn, confidenceVariant } from "@/lib/utils";
import type { ExtractedField, FieldType } from "@/types/extraction";

interface ExtractionTableProps {
  fields: ExtractedField[];
  onFieldsChange: (fields: ExtractedField[]) => void;
  readOnly?: boolean;
}

const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  text: "Text",
  date: "Date",
  number: "Number",
  email: "Email",
  phone: "Phone",
  address: "Address",
  name: "Name",
  currency: "Currency",
  other: "Other",
};

export function ExtractionTable({ fields, onFieldsChange, readOnly = false }: ExtractionTableProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [dirtyIds, setDirtyIds] = useState<Set<string>>(new Set());

  const startEditing = useCallback((field: ExtractedField) => {
    if (readOnly) return;
    setEditingId(field.id);
    setEditValue(field.value);
  }, [readOnly]);

  const cancelEditing = useCallback(() => {
    setEditingId(null);
    setEditValue("");
  }, []);

  const commitEdit = useCallback(() => {
    if (!editingId) return;
    const updated = fields.map((f) =>
      f.id === editingId ? { ...f, value: editValue } : f
    );
    onFieldsChange(updated);
    setDirtyIds((prev) => new Set(prev).add(editingId));
    setEditingId(null);
    setEditValue("");
  }, [editingId, editValue, fields, onFieldsChange]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") commitEdit();
      if (e.key === "Escape") cancelEditing();
    },
    [commitEdit, cancelEditing]
  );

  if (fields.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-muted/30 p-6 text-center">
        <p className="text-sm text-muted-foreground">No fields extracted from this document.</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/50">
            <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Label</th>
            <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Value</th>
            <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Type</th>
            <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">Confidence</th>
            {!readOnly && (
              <th className="px-4 py-2.5 w-10" />
            )}
          </tr>
        </thead>
        <tbody>
          {fields.map((field) => (
            <tr
              key={field.id}
              className={cn(
                "border-b border-border last:border-0 transition-colors",
                dirtyIds.has(field.id) && "bg-primary/5"
              )}
            >
              <td className="px-4 py-2.5 font-medium text-foreground">{field.label}</td>
              <td className="px-4 py-2.5">
                {editingId === field.id ? (
                  <div className="flex items-center gap-1">
                    <Input
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onKeyDown={handleKeyDown}
                      onBlur={commitEdit}
                      autoFocus
                      className="h-7 text-sm"
                    />
                    <button
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={commitEdit}
                      className="shrink-0 rounded p-0.5 text-status-success hover:bg-muted"
                    >
                      <Check className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={cancelEditing}
                      className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ) : (
                  <span
                    className={cn(
                      "text-foreground",
                      !readOnly && "cursor-pointer hover:underline"
                    )}
                    onClick={() => startEditing(field)}
                    role={readOnly ? undefined : "button"}
                    tabIndex={readOnly ? undefined : 0}
                    onKeyDown={(e) => {
                      if (!readOnly && (e.key === "Enter" || e.key === " ")) startEditing(field);
                    }}
                  >
                    {field.value || <span className="text-muted-foreground italic">empty</span>}
                  </span>
                )}
              </td>
              <td className="px-4 py-2.5">
                <Badge variant="secondary">{FIELD_TYPE_LABELS[field.fieldType] ?? field.fieldType}</Badge>
              </td>
              <td className="px-4 py-2.5 text-right">
                <Badge variant={confidenceVariant(field.confidence)}>
                  {Math.round(field.confidence * 100)}%
                </Badge>
              </td>
              {!readOnly && (
                <td className="px-4 py-2.5">
                  {editingId !== field.id && (
                    <button
                      onClick={() => startEditing(field)}
                      className="rounded p-1 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
