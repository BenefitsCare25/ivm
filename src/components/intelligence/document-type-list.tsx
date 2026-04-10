"use client";

import { useState, useRef, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { Plus, Pencil, Trash2, X, Loader2, HelpCircle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { DocumentTypeData } from "@/types/intelligence";

const CATEGORY_OPTIONS = [
  "Financial",
  "Medical",
  "Legal",
  "Insurance",
  "Government",
  "HR",
  "Identity",
  "Other",
];

interface DocumentTypeListProps {
  documentTypes: DocumentTypeData[];
}

interface FormState {
  name: string;
  category: string;
  aliases: string[];
  requiredFields: string[];
  isActive: boolean;
}

const emptyForm: FormState = {
  name: "",
  category: "",
  aliases: [],
  requiredFields: [],
  isActive: true,
};

export function DocumentTypeList({ documentTypes }: DocumentTypeListProps) {
  const router = useRouter();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const aliasInputRef = useRef<HTMLInputElement>(null);
  const fieldInputRef = useRef<HTMLInputElement>(null);

  function startCreate() {
    setEditingId(null);
    setForm(emptyForm);
    setError(null);
    setCreating(true);
  }

  function startEdit(dt: DocumentTypeData) {
    setCreating(false);
    setForm({
      name: dt.name,
      category: dt.category ?? "",
      aliases: dt.aliases,
      requiredFields: dt.requiredFields,
      isActive: dt.isActive,
    });
    setError(null);
    setEditingId(dt.id);
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

    setSaving(true);
    setError(null);

    try {
      const body = {
        name: form.name.trim(),
        category: form.category.trim() || null,
        aliases: form.aliases,
        requiredFields: form.requiredFields,
        isActive: form.isActive,
      };

      const url = editingId
        ? `/api/intelligence/document-types/${editingId}`
        : "/api/intelligence/document-types";

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
      setError(err instanceof Error ? err.message : "An unexpected error occurred.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    setDeleting(id);
    setError(null);

    try {
      const res = await fetch(`/api/intelligence/document-types/${id}`, {
        method: "DELETE",
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? `Failed to delete (${res.status})`);
      }

      if (editingId === id) cancel();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred.");
    } finally {
      setDeleting(null);
    }
  }

  function handleTagKeyDown(
    e: KeyboardEvent<HTMLInputElement>,
    field: "aliases" | "requiredFields",
    inputRef: React.RefObject<HTMLInputElement | null>
  ) {
    if (e.key !== "Enter") return;
    e.preventDefault();

    const value = e.currentTarget.value.trim();
    if (!value) return;
    if (form[field].includes(value)) {
      e.currentTarget.value = "";
      return;
    }

    setForm((prev) => ({ ...prev, [field]: [...prev[field], value] }));
    if (inputRef.current) inputRef.current.value = "";
  }

  function removeTag(field: "aliases" | "requiredFields", index: number) {
    setForm((prev) => ({
      ...prev,
      [field]: prev[field].filter((_, i) => i !== index),
    }));
  }

  const isFormOpen = creating || editingId !== null;

  return (
    <div className="space-y-4">
      {!isFormOpen && (
        <div className="flex justify-end">
          <Button onClick={startCreate} size="sm">
            <Plus className="mr-1.5 h-4 w-4" />
            New Document Type
          </Button>
        </div>
      )}

      {isFormOpen && !editingId && (
        <DocumentTypeForm
          form={form}
          setForm={setForm}
          saving={saving}
          error={error}
          onSave={handleSave}
          onCancel={cancel}
          aliasInputRef={aliasInputRef}
          fieldInputRef={fieldInputRef}
          onTagKeyDown={handleTagKeyDown}
          onRemoveTag={removeTag}
          title="New Document Type"
        />
      )}

      {documentTypes.map((dt) =>
        editingId === dt.id ? (
          <DocumentTypeForm
            key={dt.id}
            form={form}
            setForm={setForm}
            saving={saving}
            error={error}
            onSave={handleSave}
            onCancel={cancel}
            aliasInputRef={aliasInputRef}
            fieldInputRef={fieldInputRef}
            onTagKeyDown={handleTagKeyDown}
            onRemoveTag={removeTag}
            title={`Edit: ${dt.name}`}
          />
        ) : (
          <DocumentTypeCard
            key={dt.id}
            dt={dt}
            onEdit={() => startEdit(dt)}
            onDelete={() => handleDelete(dt.id)}
            deleting={deleting === dt.id}
            disabled={isFormOpen}
          />
        )
      )}
    </div>
  );
}

function DocumentTypeForm({
  form,
  setForm,
  saving,
  error,
  onSave,
  onCancel,
  aliasInputRef,
  fieldInputRef,
  onTagKeyDown,
  onRemoveTag,
  title,
}: {
  form: FormState;
  setForm: React.Dispatch<React.SetStateAction<FormState>>;
  saving: boolean;
  error: string | null;
  onSave: () => void;
  onCancel: () => void;
  aliasInputRef: React.RefObject<HTMLInputElement | null>;
  fieldInputRef: React.RefObject<HTMLInputElement | null>;
  onTagKeyDown: (
    e: KeyboardEvent<HTMLInputElement>,
    field: "aliases" | "requiredFields",
    ref: React.RefObject<HTMLInputElement | null>
  ) => void;
  onRemoveTag: (field: "aliases" | "requiredFields", index: number) => void;
  title: string;
}) {
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
              onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
              disabled={saving}
              placeholder="e.g. Medical Invoice"
              className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Category
            </label>
            <input
              list="category-options"
              type="text"
              value={form.category}
              onChange={(e) => setForm((p) => ({ ...p, category: e.target.value }))}
              disabled={saving}
              placeholder="Select or type a category"
              className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
            />
            <datalist id="category-options">
              {CATEGORY_OPTIONS.map((opt) => (
                <option key={opt} value={opt} />
              ))}
            </datalist>
          </div>

          <TagInput
            label="Aliases"
            hint='e.g. "med inv", "hospital bill"'
            subtext="Alternative names the AI uses for fuzzy matching"
            items={form.aliases}
            inputRef={aliasInputRef}
            disabled={saving}
            onKeyDown={(e) => onTagKeyDown(e, "aliases", aliasInputRef)}
            onRemove={(i) => onRemoveTag("aliases", i)}
          />

          <TagInput
            label="Required in extracted data"
            hint='e.g. "Invoice Date", "Patient Name"'
            subtext="Fields that must be present — missing fields generate FAIL validations"
            items={form.requiredFields}
            inputRef={fieldInputRef}
            disabled={saving}
            onKeyDown={(e) => onTagKeyDown(e, "requiredFields", fieldInputRef)}
            onRemove={(i) => onRemoveTag("requiredFields", i)}
            helpIcon
          />
        </div>

        <div className="mt-4 flex items-center gap-2">
          <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(e) => setForm((p) => ({ ...p, isActive: e.target.checked }))}
              disabled={saving}
              className="h-4 w-4 rounded border-border"
            />
            Active
          </label>
        </div>

        {error && (
          <div className="mt-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}

        <div className="mt-4 flex items-center gap-2">
          <Button onClick={onSave} disabled={saving} size="sm">
            {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
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

function TagInput({
  label,
  hint,
  subtext,
  items,
  inputRef,
  disabled,
  onKeyDown,
  onRemove,
  helpIcon,
}: {
  label: string;
  hint: string;
  subtext?: string;
  items: string[];
  inputRef: React.RefObject<HTMLInputElement | null>;
  disabled: boolean;
  onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void;
  onRemove: (index: number) => void;
  helpIcon?: boolean;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center gap-1">
        <label className="text-xs font-medium text-muted-foreground">{label}</label>
        {helpIcon && (
          <span
            title="Fields that must be found in AI-extracted content for this document type. Missing fields generate FAIL validations in Portal Tracker."
          >
            <HelpCircle className="h-3 w-3 text-muted-foreground/50" />
          </span>
        )}
      </div>
      {subtext && (
        <p className="mb-1.5 text-[11px] text-muted-foreground/60">{subtext}</p>
      )}
      <input
        ref={inputRef}
        type="text"
        disabled={disabled}
        placeholder={`${hint} — press Enter to add`}
        onKeyDown={onKeyDown}
        className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
      />
      {items.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {items.map((item, i) => (
            <span
              key={`${item}-${i}`}
              className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-xs text-secondary-foreground"
            >
              {item}
              <button
                type="button"
                onClick={() => onRemove(i)}
                disabled={disabled}
                className="ml-0.5 rounded-full p-0.5 hover:bg-foreground/10 transition-colors disabled:opacity-50"
                aria-label={`Remove ${item}`}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function DocumentTypeCard({
  dt,
  onEdit,
  onDelete,
  deleting,
  disabled,
}: {
  dt: DocumentTypeData;
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
            <span className="text-sm font-semibold text-foreground">{dt.name}</span>
            {dt.category && (
              <Badge variant="secondary" className="text-[11px]">
                {dt.category}
              </Badge>
            )}
            <Badge variant={dt.isActive ? "success" : "outline"} className="text-[11px]">
              {dt.isActive ? "Active" : "Inactive"}
            </Badge>
          </div>

          {dt.aliases.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[11px] text-muted-foreground/60">Aliases:</span>
              {dt.aliases.map((alias, i) => (
                <span
                  key={`${alias}-${i}`}
                  className="inline-flex rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground"
                >
                  {alias}
                </span>
              ))}
            </div>
          )}

          {dt.requiredFields.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[11px] text-muted-foreground/60">Validates:</span>
              {dt.requiredFields.map((field, i) => (
                <span
                  key={`${field}-${i}`}
                  className="inline-flex rounded-full bg-primary/10 px-2 py-0.5 text-[11px] text-primary"
                >
                  {field}
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <Button variant="ghost" size="icon" onClick={onEdit} aria-label="Edit">
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
