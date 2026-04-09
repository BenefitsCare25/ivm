"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Pencil, Trash2, Loader2, ArrowRightLeft } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { CodeMappingRuleData } from "@/types/intelligence";
import { MATCH_STRATEGIES, MATCH_STRATEGY_LABELS } from "@/types/intelligence";

interface CodeMappingRuleListProps {
  rules: CodeMappingRuleData[];
  datasets: { id: string; name: string; columns: string[] }[];
}

interface FormState {
  name: string;
  sourceFieldLabel: string;
  datasetId: string;
  lookupColumn: string;
  outputColumn: string;
  matchStrategy: string;
  isActive: boolean;
}

const emptyForm: FormState = {
  name: "",
  sourceFieldLabel: "",
  datasetId: "",
  lookupColumn: "",
  outputColumn: "",
  matchStrategy: "fuzzy",
  isActive: true,
};

const STRATEGY_VARIANT: Record<string, "default" | "secondary" | "outline"> = {
  exact: "default",
  fuzzy: "secondary",
  contains: "outline",
  ai: "outline",
};

export function CodeMappingRuleList({ rules, datasets }: CodeMappingRuleListProps) {
  const router = useRouter();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isFormOpen = creating || editingId !== null;

  function startCreate() {
    setEditingId(null);
    setForm(emptyForm);
    setError(null);
    setCreating(true);
  }

  function startEdit(rule: CodeMappingRuleData) {
    setCreating(false);
    setForm({
      name: rule.name,
      sourceFieldLabel: rule.sourceFieldLabel,
      datasetId: rule.datasetId,
      lookupColumn: rule.lookupColumn,
      outputColumn: rule.outputColumn,
      matchStrategy: rule.matchStrategy,
      isActive: rule.isActive,
    });
    setError(null);
    setEditingId(rule.id);
  }

  function cancel() {
    setCreating(false);
    setEditingId(null);
    setForm(emptyForm);
    setError(null);
  }

  async function handleSave() {
    if (!form.name.trim() || !form.sourceFieldLabel.trim() || !form.datasetId || !form.lookupColumn.trim() || !form.outputColumn.trim()) {
      setError("All fields are required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const body = {
        name: form.name.trim(),
        sourceFieldLabel: form.sourceFieldLabel.trim(),
        datasetId: form.datasetId,
        lookupColumn: form.lookupColumn.trim(),
        outputColumn: form.outputColumn.trim(),
        matchStrategy: form.matchStrategy,
        isActive: form.isActive,
      };
      const url = editingId
        ? `/api/intelligence/mapping-rules/${editingId}`
        : "/api/intelligence/mapping-rules";
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
      const res = await fetch(`/api/intelligence/mapping-rules/${id}`, { method: "DELETE" });
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

  const selectedDataset = datasets.find((d) => d.id === form.datasetId);

  return (
    <div className="space-y-4">
      {!isFormOpen && (
        <div className="flex justify-end">
          <Button onClick={startCreate} size="sm" disabled={datasets.length === 0}>
            <Plus className="mr-1.5 h-4 w-4" />
            New Rule
          </Button>
        </div>
      )}

      {datasets.length === 0 && !isFormOpen && (
        <div className="rounded-md bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          Create a reference dataset first before adding mapping rules.
        </div>
      )}

      {error && (
        <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {isFormOpen && !editingId && (
        <RuleForm
          form={form}
          setForm={setForm}
          saving={saving}
          error={null}
          onSave={handleSave}
          onCancel={cancel}
          datasets={datasets}
          selectedDataset={selectedDataset}
          title="New Mapping Rule"
        />
      )}

      {rules.length === 0 && !creating && (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border py-12 text-center">
          <ArrowRightLeft className="h-10 w-10 text-muted-foreground/40" />
          <p className="text-sm font-medium text-muted-foreground">No mapping rules yet</p>
          <p className="text-xs text-muted-foreground/60">
            Map extracted field values to standard codes from your reference datasets.
          </p>
        </div>
      )}

      {rules.map((rule) =>
        editingId === rule.id ? (
          <RuleForm
            key={rule.id}
            form={form}
            setForm={setForm}
            saving={saving}
            error={null}
            onSave={handleSave}
            onCancel={cancel}
            datasets={datasets}
            selectedDataset={selectedDataset}
            title={`Edit: ${rule.name}`}
          />
        ) : (
          <Card key={rule.id} className={isFormOpen ? "opacity-60 pointer-events-none" : ""}>
            <CardContent className="flex items-start justify-between gap-4 pt-6">
              <div className="min-w-0 flex-1 space-y-1.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold text-foreground">{rule.name}</span>
                  <Badge
                    variant={STRATEGY_VARIANT[rule.matchStrategy] ?? "outline"}
                    className="text-[11px]"
                  >
                    {MATCH_STRATEGY_LABELS[rule.matchStrategy as keyof typeof MATCH_STRATEGY_LABELS] ?? rule.matchStrategy}
                  </Badge>
                  <Badge variant={rule.isActive ? "success" : "outline"} className="text-[11px]">
                    {rule.isActive ? "Active" : "Inactive"}
                  </Badge>
                </div>
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground flex-wrap">
                  <span className="font-medium text-foreground/70">{rule.sourceFieldLabel}</span>
                  <span className="text-muted-foreground/50">→</span>
                  <span>{rule.dataset?.name ?? rule.datasetId}</span>
                  <span className="text-muted-foreground/50">·</span>
                  <span className="font-mono">{rule.lookupColumn}</span>
                  <span className="text-muted-foreground/50">→</span>
                  <span className="font-mono">{rule.outputColumn}</span>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button variant="ghost" size="icon" onClick={() => startEdit(rule)} aria-label="Edit">
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => handleDelete(rule.id)}
                  disabled={deleting === rule.id}
                  aria-label="Delete"
                  className="text-destructive hover:text-destructive"
                >
                  {deleting === rule.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        )
      )}
    </div>
  );
}

function RuleForm({
  form,
  setForm,
  saving,
  error,
  onSave,
  onCancel,
  datasets,
  selectedDataset,
  title,
}: {
  form: FormState;
  setForm: React.Dispatch<React.SetStateAction<FormState>>;
  saving: boolean;
  error: string | null;
  onSave: () => void;
  onCancel: () => void;
  datasets: { id: string; name: string; columns: string[] }[];
  selectedDataset: { id: string; name: string; columns: string[] } | undefined;
  title: string;
}) {
  const inputClass =
    "h-9 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50";

  return (
    <Card>
      <CardContent className="pt-6">
        <h3 className="mb-4 text-sm font-semibold text-foreground">{title}</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Rule Name <span className="text-destructive">*</span>
            </label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
              disabled={saving}
              placeholder="e.g. Map Diagnosis Code"
              className={inputClass}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Source Field Label <span className="text-destructive">*</span>
            </label>
            <input
              type="text"
              value={form.sourceFieldLabel}
              onChange={(e) => setForm((p) => ({ ...p, sourceFieldLabel: e.target.value }))}
              disabled={saving}
              placeholder="e.g. Diagnosis"
              className={inputClass}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Dataset <span className="text-destructive">*</span>
            </label>
            <select
              value={form.datasetId}
              onChange={(e) =>
                setForm((p) => ({ ...p, datasetId: e.target.value, lookupColumn: "", outputColumn: "" }))
              }
              disabled={saving}
              className={inputClass}
            >
              <option value="">Select a dataset...</option>
              {datasets.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Match Strategy <span className="text-destructive">*</span>
            </label>
            <select
              value={form.matchStrategy}
              onChange={(e) => setForm((p) => ({ ...p, matchStrategy: e.target.value }))}
              disabled={saving}
              className={inputClass}
            >
              {MATCH_STRATEGIES.map((s) => (
                <option key={s} value={s}>
                  {MATCH_STRATEGY_LABELS[s]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Lookup Column <span className="text-destructive">*</span>
            </label>
            {selectedDataset && selectedDataset.columns.length > 0 ? (
              <select
                value={form.lookupColumn}
                onChange={(e) => setForm((p) => ({ ...p, lookupColumn: e.target.value }))}
                disabled={saving}
                className={inputClass}
              >
                <option value="">Select column...</option>
                {selectedDataset.columns.map((col) => (
                  <option key={col} value={col}>
                    {col}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                value={form.lookupColumn}
                onChange={(e) => setForm((p) => ({ ...p, lookupColumn: e.target.value }))}
                disabled={saving}
                placeholder="Column to match against"
                className={inputClass}
              />
            )}
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Output Column <span className="text-destructive">*</span>
            </label>
            {selectedDataset && selectedDataset.columns.length > 0 ? (
              <select
                value={form.outputColumn}
                onChange={(e) => setForm((p) => ({ ...p, outputColumn: e.target.value }))}
                disabled={saving}
                className={inputClass}
              >
                <option value="">Select column...</option>
                {selectedDataset.columns.map((col) => (
                  <option key={col} value={col}>
                    {col}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                value={form.outputColumn}
                onChange={(e) => setForm((p) => ({ ...p, outputColumn: e.target.value }))}
                disabled={saving}
                placeholder="Column to return as result"
                className={inputClass}
              />
            )}
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
