"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Pencil, Trash2, Loader2, X, Eye, EyeOff } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { ExtractionTemplateData, ExpectedField } from "@/types/intelligence";

type Tab = "templates" | "normalization" | "escalation";

interface NormRule {
  id: string;
  name: string;
  fieldType: string;
  pattern: string | null;
  outputFormat: string;
  isActive: boolean;
  createdAt: string;
}

interface EscalationConfigData {
  confidenceThreshold: number;
  autoFlagLowConfidence: boolean;
  escalationMessage: string;
}

interface ExtractionConfigProps {
  templates: ExtractionTemplateData[];
  documentTypes: { id: string; name: string }[];
  normRules: NormRule[];
  escalationConfig: EscalationConfigData | null;
}

const FIELD_TYPES = ["text", "number", "date", "boolean", "currency", "percentage"];

const inputCls =
  "h-8 w-full rounded-md border border-border bg-background px-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring";
const selectCls = inputCls + " cursor-pointer";

export function ExtractionConfig({ templates, documentTypes, normRules, escalationConfig }: ExtractionConfigProps) {
  const [activeTab, setActiveTab] = useState<Tab>("templates");

  const tabs: { key: Tab; label: string }[] = [
    { key: "templates", label: "Templates" },
    { key: "normalization", label: "Normalization" },
    { key: "escalation", label: "Escalation" },
  ];

  return (
    <div className="space-y-4">
      <div className="flex gap-1 border-b border-border">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={[
              "px-4 py-2 text-sm font-medium transition-colors",
              activeTab === tab.key
                ? "text-foreground border-b-2 border-primary -mb-px"
                : "text-muted-foreground hover:text-foreground",
            ].join(" ")}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "templates" && (
        <TemplatesTab templates={templates} documentTypes={documentTypes} />
      )}
      {activeTab === "normalization" && (
        <NormalizationTab normRules={normRules} />
      )}
      {activeTab === "escalation" && (
        <EscalationTab config={escalationConfig} />
      )}
    </div>
  );
}

// ─── Prompt Preview ───────────────────────────────────────────────

function buildPromptPreview(form: TemplateFormState): string {
  const fieldLines =
    form.expectedFields.length > 0
      ? form.expectedFields
          .map((f) => `  • ${f.label || "(unnamed)"}  [${f.fieldType}${f.required ? ", required" : ", optional"}]`)
          .join("\n")
      : "  (no specific fields defined — AI will extract whatever it finds)";

  const instructionBlock = form.instructions.trim()
    ? `\nAdditional instructions:\n${form.instructions.trim()}`
    : "";

  return `System: You are an expert document extraction AI. Extract structured data from the provided document and return it as JSON.

Extract the following fields:
${fieldLines}${instructionBlock}

For each field, return:
  "value": the extracted value (null if not found)
  "confidence": a score from 0.0 (uncertain) to 1.0 (certain)

Respond only with valid JSON. Do not include explanation or markdown.`;
}

function PromptPreview({ form }: { form: TemplateFormState }) {
  return (
    <div className="rounded-md border border-blue-500/20 bg-blue-500/5 p-3 space-y-1.5">
      <p className="text-xs font-medium text-blue-600 dark:text-blue-400">AI Prompt Preview</p>
      <p className="text-xs text-muted-foreground">
        This approximates what gets sent to the AI. Actual prompt includes document content.
      </p>
      <pre className="whitespace-pre-wrap rounded bg-muted/60 p-2.5 font-mono text-[11px] leading-relaxed text-foreground/80 overflow-x-auto">
        {buildPromptPreview(form)}
      </pre>
    </div>
  );
}

// ─── Templates Tab ────────────────────────────────────────────────

interface TemplateFormState {
  name: string;
  documentTypeId: string;
  instructions: string;
  isActive: boolean;
  expectedFields: ExpectedField[];
}

const emptyTemplateForm: TemplateFormState = {
  name: "",
  documentTypeId: "",
  instructions: "",
  isActive: true,
  expectedFields: [],
};

function TemplatesTab({ templates, documentTypes }: { templates: ExtractionTemplateData[]; documentTypes: { id: string; name: string }[] }) {
  const router = useRouter();
  const [form, setForm] = useState<TemplateFormState>(emptyTemplateForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);

  const isOpen = creating || editingId !== null;

  function startCreate() { setEditingId(null); setForm(emptyTemplateForm); setError(null); setCreating(true); }
  function startEdit(t: ExtractionTemplateData) {
    setCreating(false);
    setForm({ name: t.name, documentTypeId: t.documentTypeId ?? "", instructions: t.instructions ?? "", isActive: t.isActive, expectedFields: t.expectedFields });
    setError(null);
    setEditingId(t.id);
  }
  function cancel() { setCreating(false); setEditingId(null); setForm(emptyTemplateForm); setError(null); }

  async function handleSave() {
    if (!form.name.trim()) { setError("Name is required."); return; }
    setSaving(true); setError(null);
    try {
      const body = { name: form.name.trim(), documentTypeId: form.documentTypeId || null, instructions: form.instructions.trim() || null, isActive: form.isActive, expectedFields: form.expectedFields };
      const url = editingId ? `/api/intelligence/extraction-templates/${editingId}` : "/api/intelligence/extraction-templates";
      const res = await fetch(url, { method: editingId ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) { const d = await res.json().catch(() => null); throw new Error(d?.error ?? `Failed (${res.status})`); }
      cancel(); router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unexpected error");
    } finally { setSaving(false); }
  }

  async function handleDelete(id: string) {
    setDeleting(id);
    try {
      const res = await fetch(`/api/intelligence/extraction-templates/${id}`, { method: "DELETE" });
      if (!res.ok) { const d = await res.json().catch(() => null); throw new Error(d?.error ?? `Failed (${res.status})`); }
      if (editingId === id) cancel();
      router.refresh();
    } catch (err) { setError(err instanceof Error ? err.message : "Unexpected error"); }
    finally { setDeleting(null); }
  }

  function addField() {
    setForm((p) => ({ ...p, expectedFields: [...p.expectedFields, { label: "", fieldType: "text", required: false, aliases: [] }] }));
  }

  function updateField(i: number, key: keyof ExpectedField, val: string | boolean | string[]) {
    setForm((p) => ({ ...p, expectedFields: p.expectedFields.map((f, idx) => idx === i ? { ...f, [key]: val } : f) }));
  }

  function removeField(i: number) {
    setForm((p) => ({ ...p, expectedFields: p.expectedFields.filter((_, idx) => idx !== i) }));
  }

  return (
    <div className="space-y-4">
      {!isOpen && (
        <div className="flex justify-end">
          <Button onClick={startCreate} size="sm"><Plus className="mr-1.5 h-4 w-4" />New Template</Button>
        </div>
      )}

      {error && <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}

      {isOpen && (
        <Card>
          <CardContent className="pt-5 space-y-4">
            <h3 className="text-sm font-semibold text-foreground">{editingId ? "Edit Template" : "New Template"}</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Name *</label>
                <input className={inputCls} value={form.name} disabled={saving} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Document Type</label>
                <select className={selectCls} value={form.documentTypeId} disabled={saving} onChange={(e) => setForm((p) => ({ ...p, documentTypeId: e.target.value }))}>
                  <option value="">— None —</option>
                  {documentTypes.map((dt) => <option key={dt.id} value={dt.id}>{dt.name}</option>)}
                </select>
              </div>
              <div className="sm:col-span-2">
                <div className="mb-1 flex items-center justify-between">
                  <label className="text-xs font-medium text-muted-foreground">
                    Instructions
                    <span className="ml-1 font-normal text-muted-foreground/60">(custom guidance added to the AI prompt)</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => setShowPreview((v) => !v)}
                    className="flex items-center gap-1 text-xs text-blue-500 hover:text-blue-600 transition-colors"
                  >
                    {showPreview ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                    {showPreview ? "Hide preview" : "Preview prompt"}
                  </button>
                </div>
                <textarea rows={2} className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring" value={form.instructions} disabled={saving} onChange={(e) => setForm((p) => ({ ...p, instructions: e.target.value }))} />
              </div>
              {showPreview && (
                <div className="sm:col-span-2">
                  <PromptPreview form={form} />
                </div>
              )}
              <div className="flex items-center">
                <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
                  <input type="checkbox" checked={form.isActive} disabled={saving} onChange={(e) => setForm((p) => ({ ...p, isActive: e.target.checked }))} className="h-4 w-4 rounded border-border" />Active
                </label>
              </div>
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">Expected Fields</span>
                <Button type="button" variant="outline" size="sm" onClick={addField} disabled={saving}><Plus className="mr-1 h-3 w-3" />Add Field</Button>
              </div>
              {form.expectedFields.map((f, i) => (
                <div key={i} className="mb-2 flex flex-wrap items-center gap-2">
                  <input placeholder="label" className="h-8 rounded-md border border-border bg-background px-2.5 text-sm text-foreground focus:outline-none w-28" value={f.label} onChange={(e) => updateField(i, "label", e.target.value)} />
                  <select className="h-8 rounded-md border border-border bg-background px-2 text-sm text-foreground focus:outline-none cursor-pointer" value={f.fieldType} onChange={(e) => updateField(i, "fieldType", e.target.value)}>
                    {FIELD_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                  <label className="flex items-center gap-1 text-xs text-muted-foreground cursor-pointer">
                    <input type="checkbox" checked={f.required} onChange={(e) => updateField(i, "required", e.target.checked)} className="h-3.5 w-3.5" />required
                  </label>
                  <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => removeField(i)}><X className="h-3.5 w-3.5" /></Button>
                </div>
              ))}
            </div>

            <div className="flex items-center gap-2">
              <Button onClick={handleSave} disabled={saving} size="sm">
                {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}{saving ? "Saving..." : "Save"}
              </Button>
              <Button onClick={cancel} variant="ghost" size="sm" disabled={saving}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {templates.map((t) => (
        <Card key={t.id} className={isOpen && editingId !== t.id ? "opacity-60 pointer-events-none" : ""}>
          <CardContent className="flex items-start justify-between gap-4 pt-4 pb-4">
            <div className="min-w-0 flex-1 space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-foreground">{t.name}</span>
                {t.documentType && <Badge variant="secondary" className="text-[11px]">{t.documentType.name}</Badge>}
                <Badge variant={t.isActive ? "success" : "outline"} className="text-[11px]">{t.isActive ? "Active" : "Inactive"}</Badge>
              </div>
              <p className="text-xs text-muted-foreground/70">{t.expectedFields.length} field{t.expectedFields.length !== 1 ? "s" : ""}</p>
              {t.instructions && <p className="text-xs text-muted-foreground line-clamp-1">{t.instructions}</p>}
            </div>
            <div className="flex shrink-0 gap-1">
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => startEdit(t)}><Pencil className="h-4 w-4" /></Button>
              <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => handleDelete(t.id)} disabled={deleting === t.id}>
                {deleting === t.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ─── Normalization Tab ────────────────────────────────────────────

interface NormFormState { name: string; fieldType: string; pattern: string; outputFormat: string; isActive: boolean; }
const emptyNormForm: NormFormState = { name: "", fieldType: "", pattern: "", outputFormat: "", isActive: true };

function NormalizationTab({ normRules }: { normRules: NormRule[] }) {
  const router = useRouter();
  const [form, setForm] = useState<NormFormState>(emptyNormForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isOpen = creating || editingId !== null;

  function startCreate() { setEditingId(null); setForm(emptyNormForm); setError(null); setCreating(true); }
  function startEdit(r: NormRule) { setCreating(false); setForm({ name: r.name, fieldType: r.fieldType, pattern: r.pattern ?? "", outputFormat: r.outputFormat, isActive: r.isActive }); setError(null); setEditingId(r.id); }
  function cancel() { setCreating(false); setEditingId(null); setForm(emptyNormForm); setError(null); }

  async function handleSave() {
    if (!form.name.trim() || !form.fieldType.trim() || !form.outputFormat.trim()) { setError("Name, field type and output format are required."); return; }
    setSaving(true); setError(null);
    try {
      const body = { name: form.name.trim(), fieldType: form.fieldType.trim(), pattern: form.pattern.trim() || null, outputFormat: form.outputFormat.trim(), isActive: form.isActive };
      const url = editingId ? `/api/intelligence/normalization-rules/${editingId}` : "/api/intelligence/normalization-rules";
      const res = await fetch(url, { method: editingId ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) { const d = await res.json().catch(() => null); throw new Error(d?.error ?? `Failed (${res.status})`); }
      cancel(); router.refresh();
    } catch (err) { setError(err instanceof Error ? err.message : "Unexpected error"); }
    finally { setSaving(false); }
  }

  async function handleDelete(id: string) {
    setDeleting(id);
    try {
      const res = await fetch(`/api/intelligence/normalization-rules/${id}`, { method: "DELETE" });
      if (!res.ok) { const d = await res.json().catch(() => null); throw new Error(d?.error ?? `Failed (${res.status})`); }
      if (editingId === id) cancel(); router.refresh();
    } catch (err) { setError(err instanceof Error ? err.message : "Unexpected error"); }
    finally { setDeleting(null); }
  }

  return (
    <div className="space-y-4">
      {!isOpen && <div className="flex justify-end"><Button onClick={startCreate} size="sm"><Plus className="mr-1.5 h-4 w-4" />New Rule</Button></div>}
      {error && <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}

      {isOpen && (
        <Card>
          <CardContent className="pt-5 space-y-3">
            <h3 className="text-sm font-semibold text-foreground">{editingId ? "Edit Normalization Rule" : "New Normalization Rule"}</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              {[["Name *", "name", "e.g. Date Normalizer"], ["Field Type *", "fieldType", "e.g. date"], ["Pattern (regex)", "pattern", "e.g. \\d{2}/\\d{2}/\\d{4}"], ["Output Format *", "outputFormat", "e.g. YYYY-MM-DD"]].map(([label, key, placeholder]) => (
                <div key={key}>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">{label}</label>
                  <input className={inputCls} placeholder={placeholder} value={(form as unknown as Record<string, string>)[key!]} disabled={saving}
                    onChange={(e) => setForm((p) => ({ ...p, [key]: e.target.value }))} />
                </div>
              ))}
              <div className="flex items-end">
                <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
                  <input type="checkbox" checked={form.isActive} disabled={saving} onChange={(e) => setForm((p) => ({ ...p, isActive: e.target.checked }))} className="h-4 w-4 rounded border-border" />Active
                </label>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button onClick={handleSave} disabled={saving} size="sm">
                {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}{saving ? "Saving..." : "Save"}
              </Button>
              <Button onClick={cancel} variant="ghost" size="sm" disabled={saving}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {normRules.map((r) => (
        <Card key={r.id} className={isOpen && editingId !== r.id ? "opacity-60 pointer-events-none" : ""}>
          <CardContent className="flex items-start justify-between gap-4 pt-4 pb-4">
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-foreground">{r.name}</span>
                <Badge variant="secondary" className="text-[11px]">{r.fieldType}</Badge>
                <Badge variant={r.isActive ? "success" : "outline"} className="text-[11px]">{r.isActive ? "Active" : "Inactive"}</Badge>
              </div>
              <p className="text-xs text-muted-foreground/70">
                {r.pattern ? <><code className="text-primary">{r.pattern}</code> → </> : ""}{r.outputFormat}
              </p>
            </div>
            <div className="flex shrink-0 gap-1">
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => startEdit(r)}><Pencil className="h-4 w-4" /></Button>
              <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => handleDelete(r.id)} disabled={deleting === r.id}>
                {deleting === r.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ─── Escalation Tab ───────────────────────────────────────────────

function EscalationTab({ config }: { config: EscalationConfigData | null }) {
  const router = useRouter();
  const [form, setForm] = useState<EscalationConfigData>({
    confidenceThreshold: config?.confidenceThreshold ?? 0.7,
    autoFlagLowConfidence: config?.autoFlagLowConfidence ?? true,
    escalationMessage: config?.escalationMessage ?? "Low confidence extraction — requires human review",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function handleSave() {
    setSaving(true); setError(null); setSuccess(false);
    try {
      const res = await fetch("/api/intelligence/escalation-config", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      if (!res.ok) { const d = await res.json().catch(() => null); throw new Error(d?.error ?? `Failed (${res.status})`); }
      setSuccess(true);
      router.refresh();
    } catch (err) { setError(err instanceof Error ? err.message : "Unexpected error"); }
    finally { setSaving(false); }
  }

  return (
    <Card>
      <CardContent className="pt-6 space-y-4">
        {!config && (
          <div className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
            Not configured yet. Set values below and save to create your escalation config.
          </div>
        )}

        <div className="space-y-4 max-w-lg">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Confidence Threshold (0–1) — currently {form.confidenceThreshold.toFixed(2)}
            </label>
            <input type="range" min={0} max={1} step={0.01} value={form.confidenceThreshold} disabled={saving}
              onChange={(e) => setForm((p) => ({ ...p, confidenceThreshold: parseFloat(e.target.value) }))}
              className="w-full accent-primary" />
            <div className="flex justify-between text-xs text-muted-foreground/60 mt-0.5">
              <span>0 (flag all)</span><span>1 (flag none)</span>
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
            <input type="checkbox" checked={form.autoFlagLowConfidence} disabled={saving}
              onChange={(e) => setForm((p) => ({ ...p, autoFlagLowConfidence: e.target.checked }))}
              className="h-4 w-4 rounded border-border" />
            Auto-flag low confidence extractions
          </label>

          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Escalation Message</label>
            <textarea rows={3} value={form.escalationMessage} disabled={saving}
              onChange={(e) => setForm((p) => ({ ...p, escalationMessage: e.target.value }))}
              className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring" />
          </div>
        </div>

        {error && <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}
        {success && <div className="rounded-md bg-green-500/10 px-3 py-2 text-sm text-green-600">Saved successfully.</div>}

        <Button onClick={handleSave} disabled={saving} size="sm">
          {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}{saving ? "Saving..." : "Save Config"}
        </Button>
      </CardContent>
    </Card>
  );
}
