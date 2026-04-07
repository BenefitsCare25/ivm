"use client";

import { useState, useCallback } from "react";
import { ArrowRight, Check, X, Pencil, AlertCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { FieldMapping } from "@/types/mapping";

interface MappingReviewTableProps {
  mappings: FieldMapping[];
  onMappingsChange: (mappings: FieldMapping[]) => void;
}

function confidenceVariant(confidence: number): "success" | "warning" | "error" {
  if (confidence >= 0.8) return "success";
  if (confidence >= 0.5) return "warning";
  return "error";
}

export function MappingReviewTable({ mappings, onMappingsChange }: MappingReviewTableProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  const mappedFields = mappings.filter((m) => m.sourceFieldId !== null);
  const unmappedFields = mappings.filter((m) => m.sourceFieldId === null);
  const approvedCount = mappedFields.filter((m) => m.userApproved).length;

  const startEditing = useCallback((mapping: FieldMapping) => {
    setEditingId(mapping.id);
    setEditValue(mapping.userOverrideValue ?? mapping.transformedValue);
  }, []);

  const cancelEditing = useCallback(() => {
    setEditingId(null);
    setEditValue("");
  }, []);

  const commitEdit = useCallback(
    (id: string) => {
      const updated = mappings.map((m) =>
        m.id === id ? { ...m, userOverrideValue: editValue } : m
      );
      onMappingsChange(updated);
      setEditingId(null);
      setEditValue("");
    },
    [editValue, mappings, onMappingsChange]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent, id: string) => {
      if (e.key === "Enter") commitEdit(id);
      if (e.key === "Escape") cancelEditing();
    },
    [commitEdit, cancelEditing]
  );

  const toggleApprove = useCallback(
    (id: string) => {
      const updated = mappings.map((m) =>
        m.id === id ? { ...m, userApproved: !m.userApproved } : m
      );
      onMappingsChange(updated);
    },
    [mappings, onMappingsChange]
  );

  const approveAll = useCallback(() => {
    const updated = mappings.map((m) =>
      m.sourceFieldId !== null ? { ...m, userApproved: true } : m
    );
    onMappingsChange(updated);
  }, [mappings, onMappingsChange]);

  if (mappings.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-muted/30 p-6 text-center">
        <p className="text-sm text-muted-foreground">No mappings available.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {/* Summary + approve-all */}
      <div className="flex items-center justify-between px-1">
        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">{mappedFields.length}</span> of{" "}
          <span className="font-medium text-foreground">{mappings.length}</span> target fields mapped
          {unmappedFields.length > 0 && (
            <span className="ml-1">
              (<span className="text-status-warning">{unmappedFields.length}</span> unmapped)
            </span>
          )}
        </p>
        {mappedFields.length > 0 && approvedCount < mappedFields.length && (
          <button
            onClick={approveAll}
            className="text-xs text-primary hover:underline"
          >
            Approve all mapped
          </button>
        )}
      </div>

      {/* Table */}
      <div className="rounded-lg border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Source Field</th>
              <th className="px-2 py-2.5 w-6" />
              <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Target Field</th>
              <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Value</th>
              <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">Confidence</th>
              <th className="px-4 py-2.5 w-10" />
            </tr>
          </thead>
          <tbody>
            {/* Mapped rows */}
            {mappedFields.map((mapping) => {
              const displayValue = mapping.userOverrideValue ?? mapping.transformedValue;
              const isEditing = editingId === mapping.id;
              const isOverridden = mapping.userOverrideValue !== undefined;

              return (
                <tr
                  key={mapping.id}
                  className={cn(
                    "border-b border-border last:border-0 transition-colors",
                    mapping.userApproved && "bg-status-success/5"
                  )}
                >
                  {/* Source field */}
                  <td className="px-4 py-2.5">
                    <span className="font-medium text-foreground">{mapping.sourceLabel}</span>
                    {mapping.sourceValue && (
                      <span className="block text-xs text-muted-foreground truncate max-w-[160px]">
                        {mapping.sourceValue}
                      </span>
                    )}
                  </td>

                  {/* Arrow */}
                  <td className="px-2 py-2.5 text-center">
                    <ArrowRight className="h-3.5 w-3.5 text-muted-foreground mx-auto" />
                  </td>

                  {/* Target field */}
                  <td className="px-4 py-2.5 font-medium text-foreground">{mapping.targetLabel}</td>

                  {/* Value (editable) */}
                  <td className="px-4 py-2.5">
                    {isEditing ? (
                      <div className="flex items-center gap-1">
                        <Input
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onKeyDown={(e) => handleKeyDown(e, mapping.id)}
                          onBlur={() => commitEdit(mapping.id)}
                          autoFocus
                          className="h-7 text-sm"
                        />
                        <button
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => commitEdit(mapping.id)}
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
                          "cursor-pointer hover:underline",
                          isOverridden ? "text-primary" : "text-foreground"
                        )}
                        onClick={() => startEditing(mapping)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") startEditing(mapping);
                        }}
                      >
                        {displayValue || (
                          <span className="text-muted-foreground italic">empty</span>
                        )}
                      </span>
                    )}
                  </td>

                  {/* Confidence */}
                  <td className="px-4 py-2.5 text-right">
                    <Badge
                      variant={confidenceVariant(mapping.confidence)}
                      title={mapping.rationale}
                    >
                      {Math.round(mapping.confidence * 100)}%
                    </Badge>
                  </td>

                  {/* Approve button */}
                  <td className="px-4 py-2.5">
                    <button
                      onClick={() => toggleApprove(mapping.id)}
                      title={mapping.userApproved ? "Approved — click to revoke" : "Approve this mapping"}
                      className={cn(
                        "rounded p-1 transition-colors",
                        mapping.userApproved
                          ? "text-status-success hover:bg-muted"
                          : "text-muted-foreground hover:text-foreground hover:bg-muted"
                      )}
                    >
                      <Check className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              );
            })}

            {/* Unmapped section separator */}
            {unmappedFields.length > 0 && (
              <>
                <tr className="border-b border-border bg-muted/30">
                  <td colSpan={6} className="px-4 py-2 text-xs font-medium text-muted-foreground">
                    <span className="flex items-center gap-1.5">
                      <AlertCircle className="h-3.5 w-3.5 text-status-warning" />
                      Unmapped target fields ({unmappedFields.length})
                    </span>
                  </td>
                </tr>

                {unmappedFields.map((mapping) => {
                  const isEditing = editingId === mapping.id;
                  const hasOverride = mapping.userOverrideValue !== undefined;

                  return (
                    <tr
                      key={mapping.id}
                      className="border-b border-border last:border-0 transition-colors"
                    >
                      {/* No source field */}
                      <td className="px-4 py-2.5">
                        <span className="italic text-muted-foreground">No match</span>
                      </td>

                      {/* Arrow */}
                      <td className="px-2 py-2.5 text-center">
                        <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/40 mx-auto" />
                      </td>

                      {/* Target field */}
                      <td className="px-4 py-2.5 font-medium text-foreground">{mapping.targetLabel}</td>

                      {/* Value (editable — fill manually) */}
                      <td className="px-4 py-2.5">
                        {isEditing ? (
                          <div className="flex items-center gap-1">
                            <Input
                              value={editValue}
                              onChange={(e) => setEditValue(e.target.value)}
                              onKeyDown={(e) => handleKeyDown(e, mapping.id)}
                              onBlur={() => commitEdit(mapping.id)}
                              autoFocus
                              className="h-7 text-sm"
                            />
                            <button
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() => commitEdit(mapping.id)}
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
                              "cursor-pointer hover:underline",
                              hasOverride ? "text-primary" : "italic text-muted-foreground/70"
                            )}
                            onClick={() => startEditing(mapping)}
                            role="button"
                            tabIndex={0}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") startEditing(mapping);
                            }}
                          >
                            {hasOverride
                              ? mapping.userOverrideValue
                              : "Click to fill manually"}
                          </span>
                        )}
                      </td>

                      {/* No confidence badge for unmapped */}
                      <td className="px-4 py-2.5 text-right">
                        <span className="text-xs text-muted-foreground">—</span>
                      </td>

                      {/* No approve button for unmapped */}
                      <td className="px-4 py-2.5" />
                    </tr>
                  );
                })}
              </>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
