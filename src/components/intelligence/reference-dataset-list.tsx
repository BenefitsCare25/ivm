"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Pencil, Trash2, ChevronDown, ChevronUp, Loader2, Database } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { ReferenceDatasetData } from "@/types/intelligence";

interface ReferenceDatasetListProps {
  datasets: ReferenceDatasetData[];
}

interface FormState {
  name: string;
  description: string;
  isActive: boolean;
}

const emptyForm: FormState = { name: "", description: "", isActive: true };

function parseCSV(text: string): { columns: string[]; rows: string[][] } | null {
  const lines = text.trim().split("\n").filter((l) => l.trim());
  if (lines.length < 2) return null;
  const columns = lines[0].split(",").map((c) => c.trim());
  const rows = lines.slice(1).map((line) =>
    line.split(",").map((v) => v.trim())
  );
  return { columns, rows };
}

export function ReferenceDatasetList({ datasets }: ReferenceDatasetListProps) {
  const router = useRouter();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [csvText, setCsvText] = useState<Record<string, string>>({});
  const [importing, setImporting] = useState<string | null>(null);
  const [clearing, setClearing] = useState<string | null>(null);
  const [importError, setImportError] = useState<Record<string, string>>({});

  const isFormOpen = creating || editingId !== null;

  function startCreate() {
    setEditingId(null);
    setForm(emptyForm);
    setError(null);
    setCreating(true);
  }

  function startEdit(ds: ReferenceDatasetData) {
    setCreating(false);
    setForm({ name: ds.name, description: ds.description ?? "", isActive: ds.isActive });
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
    setSaving(true);
    setError(null);
    try {
      const body = {
        name: form.name.trim(),
        description: form.description.trim() || null,
        isActive: form.isActive,
      };
      const url = editingId
        ? `/api/intelligence/datasets/${editingId}`
        : "/api/intelligence/datasets";
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
      const res = await fetch(`/api/intelligence/datasets/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? `Failed to delete (${res.status})`);
      }
      if (editingId === id) cancel();
      if (expandedId === id) setExpandedId(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred.");
    } finally {
      setDeleting(null);
    }
  }

  async function handleImport(id: string) {
    const text = csvText[id] ?? "";
    const parsed = parseCSV(text);
    if (!parsed) {
      setImportError((prev) => ({
        ...prev,
        [id]: "Invalid CSV. First row must be headers, followed by at least one data row.",
      }));
      return;
    }
    setImporting(id);
    setImportError((prev) => ({ ...prev, [id]: "" }));
    try {
      const res = await fetch(`/api/intelligence/datasets/${id}/entries`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? `Import failed (${res.status})`);
      }
      const result = await res.json();
      setCsvText((prev) => ({ ...prev, [id]: "" }));
      setImportError((prev) => ({ ...prev, [id]: `Imported ${result.inserted} rows.` }));
      router.refresh();
    } catch (err) {
      setImportError((prev) => ({
        ...prev,
        [id]: err instanceof Error ? err.message : "An unexpected error occurred.",
      }));
    } finally {
      setImporting(null);
    }
  }

  async function handleClearEntries(id: string) {
    setClearing(id);
    setImportError((prev) => ({ ...prev, [id]: "" }));
    try {
      const res = await fetch(`/api/intelligence/datasets/${id}/entries`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? `Clear failed (${res.status})`);
      }
      router.refresh();
    } catch (err) {
      setImportError((prev) => ({
        ...prev,
        [id]: err instanceof Error ? err.message : "An unexpected error occurred.",
      }));
    } finally {
      setClearing(null);
    }
  }

  return (
    <div className="space-y-4">
      {!isFormOpen && (
        <div className="flex justify-end">
          <Button onClick={startCreate} size="sm">
            <Plus className="mr-1.5 h-4 w-4" />
            New Dataset
          </Button>
        </div>
      )}

      {error && (
        <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {isFormOpen && !editingId && (
        <DatasetForm
          form={form}
          setForm={setForm}
          saving={saving}
          error={null}
          onSave={handleSave}
          onCancel={cancel}
          title="New Dataset"
        />
      )}

      {datasets.length === 0 && !creating && (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border py-12 text-center">
          <Database className="h-10 w-10 text-muted-foreground/40" />
          <p className="text-sm font-medium text-muted-foreground">No datasets yet</p>
          <p className="text-xs text-muted-foreground/60">
            Create a dataset and import CSV data for code mapping lookups.
          </p>
        </div>
      )}

      {datasets.map((ds) =>
        editingId === ds.id ? (
          <DatasetForm
            key={ds.id}
            form={form}
            setForm={setForm}
            saving={saving}
            error={null}
            onSave={handleSave}
            onCancel={cancel}
            title={`Edit: ${ds.name}`}
          />
        ) : (
          <Card key={ds.id} className={isFormOpen ? "opacity-60 pointer-events-none" : ""}>
            <CardContent className="pt-6">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-foreground">{ds.name}</span>
                    <Badge variant={ds.isActive ? "success" : "outline"} className="text-[11px]">
                      {ds.isActive ? "Active" : "Inactive"}
                    </Badge>
                    <Badge variant="secondary" className="text-[11px]">
                      {ds.rowCount} row{ds.rowCount !== 1 ? "s" : ""}
                    </Badge>
                    {ds.columns.length > 0 && (
                      <Badge variant="outline" className="text-[11px]">
                        {ds.columns.length} column{ds.columns.length !== 1 ? "s" : ""}
                      </Badge>
                    )}
                  </div>
                  {ds.description && (
                    <p className="text-xs text-muted-foreground">{ds.description}</p>
                  )}
                  {ds.columns.length > 0 && (
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-xs text-muted-foreground/60">Columns:</span>
                      {ds.columns.map((col, i) => (
                        <span
                          key={`${col}-${i}`}
                          className="inline-flex rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground"
                        >
                          {col}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setExpandedId(expandedId === ds.id ? null : ds.id)}
                    className="text-xs"
                  >
                    {expandedId === ds.id ? (
                      <ChevronUp className="mr-1 h-3.5 w-3.5" />
                    ) : (
                      <ChevronDown className="mr-1 h-3.5 w-3.5" />
                    )}
                    Manage Data
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => startEdit(ds)}
                    aria-label="Edit"
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleDelete(ds.id)}
                    disabled={deleting === ds.id}
                    aria-label="Delete"
                    className="text-destructive hover:text-destructive"
                  >
                    {deleting === ds.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>

              {expandedId === ds.id && (
                <div className="mt-4 space-y-3 rounded-md bg-muted/40 p-4">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-medium text-muted-foreground">
                      Import CSV data (first row = column headers)
                    </p>
                    {ds.rowCount > 0 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleClearEntries(ds.id)}
                        disabled={clearing === ds.id}
                        className="text-xs text-destructive hover:text-destructive"
                      >
                        {clearing === ds.id ? (
                          <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                        ) : (
                          <Trash2 className="mr-1 h-3 w-3" />
                        )}
                        Clear all data
                      </Button>
                    )}
                  </div>
                  <textarea
                    rows={6}
                    value={csvText[ds.id] ?? ""}
                    onChange={(e) =>
                      setCsvText((prev) => ({ ...prev, [ds.id]: e.target.value }))
                    }
                    placeholder={"column1,column2,column3\nvalue1,value2,value3\nvalue4,value5,value6"}
                    className="w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-xs text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-ring resize-none"
                  />
                  {importError[ds.id] && (
                    <p
                      className={`text-xs ${importError[ds.id].startsWith("Imported") ? "text-foreground" : "text-destructive"}`}
                    >
                      {importError[ds.id]}
                    </p>
                  )}
                  <Button
                    size="sm"
                    onClick={() => handleImport(ds.id)}
                    disabled={importing === ds.id || !csvText[ds.id]?.trim()}
                  >
                    {importing === ds.id && (
                      <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    )}
                    Import CSV
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        )
      )}
    </div>
  );
}

function DatasetForm({
  form,
  setForm,
  saving,
  error,
  onSave,
  onCancel,
  title,
}: {
  form: FormState;
  setForm: React.Dispatch<React.SetStateAction<FormState>>;
  saving: boolean;
  error: string | null;
  onSave: () => void;
  onCancel: () => void;
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
              placeholder="e.g. ICD-10 Codes"
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
              onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
              disabled={saving}
              placeholder="Optional description"
              className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
            />
          </div>
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
