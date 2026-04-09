"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Pencil, Trash2, X, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { DocumentSetData, DocumentSetItemData } from "@/types/intelligence";

interface DocumentSetListProps {
  documentSets: DocumentSetData[];
  availableDocTypes: { id: string; name: string }[];
}

interface FormItem {
  documentTypeId: string;
  isRequired: boolean;
  minCount: number;
  maxCount: string;
}

interface FormState {
  name: string;
  description: string;
  isActive: boolean;
  items: FormItem[];
}

const emptyForm: FormState = {
  name: "",
  description: "",
  isActive: true,
  items: [],
};

function itemFromData(item: DocumentSetItemData): FormItem {
  return {
    documentTypeId: item.documentTypeId,
    isRequired: item.isRequired,
    minCount: item.minCount,
    maxCount: item.maxCount !== null ? String(item.maxCount) : "",
  };
}

export function DocumentSetList({
  documentSets,
  availableDocTypes,
}: DocumentSetListProps) {
  const router = useRouter();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function startCreate() {
    setEditingId(null);
    setForm(emptyForm);
    setError(null);
    setCreating(true);
  }

  function startEdit(ds: DocumentSetData) {
    setCreating(false);
    setForm({
      name: ds.name,
      description: ds.description ?? "",
      isActive: ds.isActive,
      items: ds.items.map(itemFromData),
    });
    setError(null);
    setEditingId(ds.id);
  }

  function cancel() {
    setCreating(false);
    setEditingId(null);
    setForm(emptyForm);
    setError(null);
  }

  async function handleSave() {
    if (!form.name.trim()) {
      setError("Name is required.");
      return;
    }

    for (const item of form.items) {
      if (!item.documentTypeId) {
        setError("All items must have a document type selected.");
        return;
      }
    }

    const seen = new Set<string>();
    for (const item of form.items) {
      if (seen.has(item.documentTypeId)) {
        setError("Each document type can only be added once per set.");
        return;
      }
      seen.add(item.documentTypeId);
    }

    setSaving(true);
    setError(null);

    try {
      const body = {
        name: form.name.trim(),
        description: form.description.trim() || null,
        isActive: form.isActive,
        items: form.items.map((item) => ({
          documentTypeId: item.documentTypeId,
          isRequired: item.isRequired,
          minCount: item.minCount,
          maxCount: item.maxCount ? Number(item.maxCount) : null,
        })),
      };

      const url = editingId
        ? `/api/intelligence/document-sets/${editingId}`
        : "/api/intelligence/document-sets";

      const res = await fetch(url, {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? `Failed to save (${res.status})`);
      }

      cancel();
      router.refresh();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "An unexpected error occurred."
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    setDeleting(id);
    setError(null);

    try {
      const res = await fetch(`/api/intelligence/document-sets/${id}`, {
        method: "DELETE",
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? `Failed to delete (${res.status})`);
      }

      if (editingId === id) cancel();
      router.refresh();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "An unexpected error occurred."
      );
    } finally {
      setDeleting(null);
    }
  }

  const isFormOpen = creating || editingId !== null;

  return (
    <div className="space-y-4">
      {!isFormOpen && (
        <div className="flex justify-end">
          <Button onClick={startCreate} size="sm">
            <Plus className="mr-1.5 h-4 w-4" />
            New Document Set
          </Button>
        </div>
      )}

      {isFormOpen && !editingId && (
        <DocumentSetForm
          form={form}
          setForm={setForm}
          saving={saving}
          error={error}
          onSave={handleSave}
          onCancel={cancel}
          availableDocTypes={availableDocTypes}
          title="New Document Set"
        />
      )}

      {documentSets.map((ds) =>
        editingId === ds.id ? (
          <DocumentSetForm
            key={ds.id}
            form={form}
            setForm={setForm}
            saving={saving}
            error={error}
            onSave={handleSave}
            onCancel={cancel}
            availableDocTypes={availableDocTypes}
            title={`Edit: ${ds.name}`}
          />
        ) : (
          <DocumentSetCard
            key={ds.id}
            ds={ds}
            onEdit={() => startEdit(ds)}
            onDelete={() => handleDelete(ds.id)}
            deleting={deleting === ds.id}
            disabled={isFormOpen}
          />
        )
      )}
    </div>
  );
}

function DocumentSetForm({
  form,
  setForm,
  saving,
  error,
  onSave,
  onCancel,
  availableDocTypes,
  title,
}: {
  form: FormState;
  setForm: React.Dispatch<React.SetStateAction<FormState>>;
  saving: boolean;
  error: string | null;
  onSave: () => void;
  onCancel: () => void;
  availableDocTypes: { id: string; name: string }[];
  title: string;
}) {
  function addItem() {
    setForm((prev) => ({
      ...prev,
      items: [
        ...prev.items,
        { documentTypeId: "", isRequired: true, minCount: 1, maxCount: "" },
      ],
    }));
  }

  function removeItem(index: number) {
    setForm((prev) => ({
      ...prev,
      items: prev.items.filter((_, i) => i !== index),
    }));
  }

  function updateItem(index: number, patch: Partial<FormItem>) {
    setForm((prev) => ({
      ...prev,
      items: prev.items.map((item, i) =>
        i === index ? { ...item, ...patch } : item
      ),
    }));
  }

  const noDocTypesAvailable = availableDocTypes.length === 0;

  return (
    <Card>
      <CardContent className="pt-6">
        <h3 className="mb-4 text-sm font-semibold text-foreground">{title}</h3>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Name <span className="text-destructive">*</span>
            </label>
            <input
              type="text"
              value={form.name}
              onChange={(e) =>
                setForm((p) => ({ ...p, name: e.target.value }))
              }
              disabled={saving}
              placeholder="e.g. Inpatient Claim"
              className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Description
            </label>
            <input
              type="text"
              value={form.description}
              onChange={(e) =>
                setForm((p) => ({ ...p, description: e.target.value }))
              }
              disabled={saving}
              placeholder="e.g. Documents required for inpatient claims"
              className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
            />
          </div>
        </div>

        <div className="mt-4 flex items-center gap-2">
          <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(e) =>
                setForm((p) => ({ ...p, isActive: e.target.checked }))
              }
              disabled={saving}
              className="h-4 w-4 rounded border-border"
            />
            Active
          </label>
        </div>

        <div className="mt-5">
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs font-medium text-muted-foreground">
              Document Types in Set
            </label>
            {!noDocTypesAvailable && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addItem}
                disabled={saving}
                className="h-7 text-xs"
              >
                <Plus className="mr-1 h-3 w-3" />
                Add Document Type
              </Button>
            )}
          </div>

          {noDocTypesAvailable && (
            <div className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
              No active document types available. Create document types first
              before adding them to a set.
            </div>
          )}

          {form.items.length === 0 && !noDocTypesAvailable && (
            <div className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
              No document types added yet. Click &quot;Add Document Type&quot;
              to define what documents belong in this set.
            </div>
          )}

          {form.items.length > 0 && (
            <div className="space-y-2">
              {form.items.map((item, index) => {
                const otherSelected = new Set(
                  form.items
                    .filter((_, i) => i !== index)
                    .map((i) => i.documentTypeId)
                    .filter(Boolean)
                );

                return (
                  <div
                    key={index}
                    className="flex items-center gap-2 rounded-md border border-border bg-background p-2"
                  >
                    <select
                      value={item.documentTypeId}
                      onChange={(e) =>
                        updateItem(index, { documentTypeId: e.target.value })
                      }
                      disabled={saving}
                      className="h-8 flex-1 min-w-0 rounded-md border border-border bg-background px-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
                    >
                      <option value="">Select type...</option>
                      {availableDocTypes.map((dt) => (
                        <option
                          key={dt.id}
                          value={dt.id}
                          disabled={otherSelected.has(dt.id)}
                        >
                          {dt.name}
                        </option>
                      ))}
                    </select>

                    <label className="flex shrink-0 items-center gap-1.5 text-xs text-foreground cursor-pointer">
                      <input
                        type="checkbox"
                        checked={item.isRequired}
                        onChange={(e) =>
                          updateItem(index, { isRequired: e.target.checked })
                        }
                        disabled={saving}
                        className="h-3.5 w-3.5 rounded border-border"
                      />
                      Required
                    </label>

                    <div className="flex shrink-0 items-center gap-1">
                      <label className="text-xs text-muted-foreground">
                        Min
                      </label>
                      <input
                        type="number"
                        min={0}
                        value={item.minCount}
                        onChange={(e) =>
                          updateItem(index, {
                            minCount: Math.max(0, Number(e.target.value) || 0),
                          })
                        }
                        disabled={saving}
                        className="h-8 w-14 rounded-md border border-border bg-background px-2 text-sm text-foreground text-center focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
                      />
                    </div>

                    <div className="flex shrink-0 items-center gap-1">
                      <label className="text-xs text-muted-foreground">
                        Max
                      </label>
                      <input
                        type="number"
                        min={0}
                        value={item.maxCount}
                        onChange={(e) =>
                          updateItem(index, { maxCount: e.target.value })
                        }
                        disabled={saving}
                        placeholder="--"
                        className="h-8 w-14 rounded-md border border-border bg-background px-2 text-sm text-foreground text-center placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
                      />
                    </div>

                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => removeItem(index)}
                      disabled={saving}
                      className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                      aria-label="Remove item"
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {error && (
          <div className="mt-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}

        <div className="mt-4 flex items-center gap-2">
          <Button onClick={onSave} disabled={saving} size="sm">
            {saving && (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            )}
            {saving ? "Saving..." : "Save"}
          </Button>
          <Button onClick={onCancel} variant="ghost" size="sm" disabled={saving}>
            Cancel
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function DocumentSetCard({
  ds,
  onEdit,
  onDelete,
  deleting,
  disabled,
}: {
  ds: DocumentSetData;
  onEdit: () => void;
  onDelete: () => void;
  deleting: boolean;
  disabled: boolean;
}) {
  return (
    <Card className={disabled ? "opacity-60 pointer-events-none" : ""}>
      <CardContent className="flex items-start justify-between gap-4 pt-6">
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-foreground">
              {ds.name}
            </span>
            <Badge
              variant={ds.isActive ? "success" : "outline"}
              className="text-[11px]"
            >
              {ds.isActive ? "Active" : "Inactive"}
            </Badge>
          </div>

          {ds.description && (
            <p className="text-xs text-muted-foreground">{ds.description}</p>
          )}

          {ds.items.length > 0 ? (
            <div className="space-y-1">
              {ds.items.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center gap-2 flex-wrap"
                >
                  <span className="text-xs text-foreground">
                    {item.documentType.name}
                  </span>
                  <Badge
                    variant={item.isRequired ? "info" : "secondary"}
                    className="text-[10px] px-1.5 py-0"
                  >
                    {item.isRequired ? "Required" : "Optional"}
                  </Badge>
                  <span className="text-[11px] text-muted-foreground">
                    Min: {item.minCount}
                  </span>
                  {item.maxCount !== null && (
                    <span className="text-[11px] text-muted-foreground">
                      Max: {item.maxCount}
                    </span>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground/60">
              No document types configured
            </p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={onEdit}
            aria-label="Edit"
          >
            <Pencil className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={onDelete}
            disabled={deleting}
            aria-label="Delete"
            className="text-destructive hover:text-destructive"
          >
            {deleting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4" />
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
