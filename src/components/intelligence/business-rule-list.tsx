"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Pencil, Trash2, Loader2, ChevronDown, ChevronUp } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  TRIGGER_POINT_LABELS,
  ACTION_TYPE_LABELS,
  OPERATOR_LABELS,
  type BusinessRuleData,
  type RuleCondition,
  type RuleAction,
  type TriggerPoint,
} from "@/types/intelligence";

interface BusinessRuleListProps {
  rules: BusinessRuleData[];
  documentTypes?: { id: string; name: string }[];
}

interface FormState {
  name: string;
  description: string;
  priority: number;
  triggerPoint: TriggerPoint;
  isActive: boolean;
  logic: "AND" | "OR";
  conditions: RuleCondition[];
  actions: RuleAction[];
}

const emptyForm: FormState = {
  name: "",
  description: "",
  priority: 0,
  triggerPoint: "POST_EXTRACTION",
  isActive: true,
  logic: "AND",
  conditions: [],
  actions: [],
};

const OPERATORS = Object.keys(OPERATOR_LABELS) as Array<keyof typeof OPERATOR_LABELS>;
const ACTION_TYPES = Object.keys(ACTION_TYPE_LABELS) as Array<keyof typeof ACTION_TYPE_LABELS>;

const inputCls =
  "h-8 rounded-md border border-border bg-background px-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring";
const selectCls = inputCls + " cursor-pointer";

// Structured param editors per action type — replaces freeform JSON textarea
function ActionParamsForm({
  action,
  index,
  onUpdate,
}: {
  action: RuleAction;
  index: number;
  onUpdate: (i: number, params: Record<string, string>) => void;
}) {
  const params = (action.params ?? {}) as Record<string, string>;

  switch (action.type) {
    case "FLAG":
      return (
        <input
          placeholder="Reason (e.g. Amount exceeds threshold)"
          className={inputCls + " flex-1 min-w-40"}
          value={params.reason ?? ""}
          onChange={(e) => onUpdate(index, { reason: e.target.value })}
        />
      );
    case "SET_STATUS":
      return (
        <select
          className={selectCls + " flex-1"}
          value={params.status ?? "REVIEW"}
          onChange={(e) => onUpdate(index, { status: e.target.value })}
        >
          {["REVIEW", "APPROVED", "REJECTED", "ESCALATED", "PENDING", "FLAGGED"].map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      );
    case "ADD_NOTE":
      return (
        <input
          placeholder="Note text"
          className={inputCls + " flex-1 min-w-40"}
          value={params.note ?? ""}
          onChange={(e) => onUpdate(index, { note: e.target.value })}
        />
      );
    case "SET_FIELD":
      return (
        <>
          <input
            placeholder="Field name"
            className={inputCls + " w-32"}
            value={params.field ?? ""}
            onChange={(e) => onUpdate(index, { ...params, field: e.target.value })}
          />
          <input
            placeholder="New value"
            className={inputCls + " flex-1 min-w-28"}
            value={params.value ?? ""}
            onChange={(e) => onUpdate(index, { ...params, value: e.target.value })}
          />
        </>
      );
    case "ESCALATE":
      return (
        <>
          <input
            placeholder="To (e.g. supervisor)"
            className={inputCls + " w-32"}
            value={params.to ?? ""}
            onChange={(e) => onUpdate(index, { ...params, to: e.target.value })}
          />
          <input
            placeholder="Reason"
            className={inputCls + " flex-1 min-w-28"}
            value={params.reason ?? ""}
            onChange={(e) => onUpdate(index, { ...params, reason: e.target.value })}
          />
        </>
      );
    case "SKIP":
      return (
        <span className="flex-1 px-1 text-xs italic text-muted-foreground">
          No parameters needed — stops further rule processing for this item.
        </span>
      );
    default:
      return null;
  }
}

export function BusinessRuleList({ rules }: BusinessRuleListProps) {
  const router = useRouter();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  function startCreate() {
    setEditingId(null);
    setForm(emptyForm);
    setError(null);
    setCreating(true);
  }

  function startEdit(rule: BusinessRuleData) {
    setCreating(false);
    setForm({
      name: rule.name,
      description: rule.description ?? "",
      priority: rule.priority,
      triggerPoint: rule.triggerPoint,
      isActive: rule.isActive,
      logic: rule.conditions.logic,
      conditions: rule.conditions.conditions,
      actions: rule.actions,
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
    if (!form.name.trim()) { setError("Name is required."); return; }

    setSaving(true);
    setError(null);

    try {
      const body = {
        name: form.name.trim(),
        description: form.description.trim() || null,
        priority: form.priority,
        triggerPoint: form.triggerPoint,
        isActive: form.isActive,
        conditions: { logic: form.logic, conditions: form.conditions },
        actions: form.actions,
        scope: {},
      };

      const url = editingId
        ? `/api/intelligence/rules/${editingId}`
        : "/api/intelligence/rules";

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
      const res = await fetch(`/api/intelligence/rules/${id}`, { method: "DELETE" });
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

  function addCondition() {
    setForm((p) => ({
      ...p,
      conditions: [...p.conditions, { field: "", operator: "equals", value: "" }],
    }));
  }

  function removeCondition(i: number) {
    setForm((p) => ({ ...p, conditions: p.conditions.filter((_, idx) => idx !== i) }));
  }

  function updateCondition(i: number, key: keyof RuleCondition, val: string) {
    setForm((p) => ({
      ...p,
      conditions: p.conditions.map((c, idx) =>
        idx === i ? { ...c, [key]: val } : c
      ),
    }));
  }

  function addAction() {
    setForm((p) => ({ ...p, actions: [...p.actions, { type: "FLAG", params: {} }] }));
  }

  function removeAction(i: number) {
    setForm((p) => ({ ...p, actions: p.actions.filter((_, idx) => idx !== i) }));
  }

  function updateAction(i: number, type: RuleAction["type"]) {
    // reset params when action type changes so stale keys don't carry over
    setForm((p) => ({
      ...p,
      actions: p.actions.map((a, idx) => (idx === i ? { type, params: {} } : a)),
    }));
  }

  function updateActionParams(i: number, params: Record<string, string>) {
    setForm((p) => ({
      ...p,
      actions: p.actions.map((a, idx) => (idx === i ? { ...a, params } : a)),
    }));
  }

  const isFormOpen = creating || editingId !== null;

  return (
    <div className="space-y-4">
      {!isFormOpen && (
        <div className="flex justify-end">
          <Button onClick={startCreate} size="sm">
            <Plus className="mr-1.5 h-4 w-4" />
            New Rule
          </Button>
        </div>
      )}

      {error && !isFormOpen && (
        <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>
      )}

      {isFormOpen && !editingId && (
        <RuleForm
          form={form} setForm={setForm} saving={saving} error={error}
          onSave={handleSave} onCancel={cancel}
          addCondition={addCondition} removeCondition={removeCondition}
          updateCondition={updateCondition} addAction={addAction}
          removeAction={removeAction} updateAction={updateAction}
          updateActionParams={updateActionParams}
          title="New Business Rule"
        />
      )}

      {rules.map((rule) =>
        editingId === rule.id ? (
          <RuleForm
            key={rule.id}
            form={form} setForm={setForm} saving={saving} error={error}
            onSave={handleSave} onCancel={cancel}
            addCondition={addCondition} removeCondition={removeCondition}
            updateCondition={updateCondition} addAction={addAction}
            removeAction={removeAction} updateAction={updateAction}
            updateActionParams={updateActionParams}
            title={`Edit: ${rule.name}`}
          />
        ) : (
          <RuleCard
            key={rule.id}
            rule={rule}
            onEdit={() => startEdit(rule)}
            onDelete={() => handleDelete(rule.id)}
            deleting={deleting === rule.id}
            disabled={isFormOpen}
            expanded={expandedId === rule.id}
            onToggle={() => setExpandedId(expandedId === rule.id ? null : rule.id)}
          />
        )
      )}
    </div>
  );
}

function RuleForm({
  form, setForm, saving, error, onSave, onCancel,
  addCondition, removeCondition, updateCondition,
  addAction, removeAction, updateAction, updateActionParams,
  title,
}: {
  form: FormState;
  setForm: React.Dispatch<React.SetStateAction<FormState>>;
  saving: boolean;
  error: string | null;
  onSave: () => void;
  onCancel: () => void;
  addCondition: () => void;
  removeCondition: (i: number) => void;
  updateCondition: (i: number, k: keyof RuleCondition, v: string) => void;
  addAction: () => void;
  removeAction: (i: number) => void;
  updateAction: (i: number, t: RuleAction["type"]) => void;
  updateActionParams: (i: number, params: Record<string, string>) => void;
  title: string;
}) {
  return (
    <Card>
      <CardContent className="pt-6 space-y-4">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Name *</label>
            <input className={inputCls + " w-full"} value={form.name} disabled={saving}
              onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Trigger</label>
            <select className={selectCls + " w-full"} value={form.triggerPoint} disabled={saving}
              onChange={(e) => setForm((p) => ({ ...p, triggerPoint: e.target.value as FormState["triggerPoint"] }))}>
              {(Object.keys(TRIGGER_POINT_LABELS) as Array<keyof typeof TRIGGER_POINT_LABELS>).map((k) => (
                <option key={k} value={k}>{TRIGGER_POINT_LABELS[k]}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Priority</label>
            <input type="number" className={inputCls + " w-full"} value={form.priority} disabled={saving}
              onChange={(e) => setForm((p) => ({ ...p, priority: parseInt(e.target.value) || 0 }))} />
          </div>
          <div className="flex items-end">
            <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
              <input type="checkbox" checked={form.isActive} disabled={saving}
                onChange={(e) => setForm((p) => ({ ...p, isActive: e.target.checked }))}
                className="h-4 w-4 rounded border-border" />
              Active
            </label>
          </div>
          <div className="sm:col-span-2">
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Description</label>
            <input className={inputCls + " w-full"} value={form.description} disabled={saving}
              onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} />
          </div>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">
              Conditions &nbsp;
              <select className="rounded border border-border bg-background px-1 text-xs" value={form.logic}
                onChange={(e) => setForm((p) => ({ ...p, logic: e.target.value as "AND" | "OR" }))}>
                <option value="AND">AND</option>
                <option value="OR">OR</option>
              </select>
            </span>
            <Button type="button" variant="outline" size="sm" onClick={addCondition} disabled={saving}>
              <Plus className="mr-1 h-3 w-3" /> Add
            </Button>
          </div>
          {form.conditions.map((c, i) => (
            <div key={i} className="mb-2 flex flex-wrap items-center gap-2">
              <input placeholder="field" className={inputCls + " w-28"} value={c.field}
                onChange={(e) => updateCondition(i, "field", e.target.value)} />
              <select className={selectCls} value={c.operator}
                onChange={(e) => updateCondition(i, "operator", e.target.value)}>
                {OPERATORS.map((op) => <option key={op} value={op}>{OPERATOR_LABELS[op]}</option>)}
              </select>
              <input placeholder="value" className={inputCls + " w-28"} value={String(c.value)}
                onChange={(e) => updateCondition(i, "value", e.target.value)} />
              <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-destructive"
                onClick={() => removeCondition(i)}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Actions</span>
            <Button type="button" variant="outline" size="sm" onClick={addAction} disabled={saving}>
              <Plus className="mr-1 h-3 w-3" /> Add
            </Button>
          </div>
          {form.actions.map((a, i) => (
            <div key={i} className="mb-2 flex flex-wrap items-center gap-2">
              <select className={selectCls} value={a.type}
                onChange={(e) => updateAction(i, e.target.value as RuleAction["type"])}>
                {ACTION_TYPES.map((t) => <option key={t} value={t}>{ACTION_TYPE_LABELS[t]}</option>)}
              </select>
              <ActionParamsForm action={a} index={i} onUpdate={updateActionParams} />
              <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-destructive"
                onClick={() => removeAction(i)}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>

        {error && (
          <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>
        )}

        <div className="flex items-center gap-2">
          <Button onClick={onSave} disabled={saving} size="sm">
            {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            {saving ? "Saving..." : "Save"}
          </Button>
          <Button onClick={onCancel} variant="ghost" size="sm" disabled={saving}>Cancel</Button>
        </div>
      </CardContent>
    </Card>
  );
}

function RuleCard({
  rule, onEdit, onDelete, deleting, disabled, expanded, onToggle,
}: {
  rule: BusinessRuleData;
  onEdit: () => void;
  onDelete: () => void;
  deleting: boolean;
  disabled: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <Card className={disabled ? "opacity-60 pointer-events-none" : ""}>
      <CardContent className="pt-4 pb-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-foreground">{rule.name}</span>
              <Badge variant="secondary" className="text-[11px]">{TRIGGER_POINT_LABELS[rule.triggerPoint]}</Badge>
              <Badge variant={rule.isActive ? "success" : "outline"} className="text-[11px]">
                {rule.isActive ? "Active" : "Inactive"}
              </Badge>
              <span className="text-xs text-muted-foreground">Priority {rule.priority}</span>
            </div>
            {rule.description && (
              <p className="text-xs text-muted-foreground">{rule.description}</p>
            )}
            <p className="text-xs text-muted-foreground/70">
              {rule.conditions.conditions.length} condition{rule.conditions.conditions.length !== 1 ? "s" : ""} &middot;{" "}
              {rule.actions.length} action{rule.actions.length !== 1 ? "s" : ""} &middot;{" "}
              Run {rule.runCount} time{rule.runCount !== 1 ? "s" : ""}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button variant="ghost" size="icon" onClick={onToggle} aria-label="Expand" className="h-8 w-8">
              {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>
            <Button variant="ghost" size="icon" onClick={onEdit} aria-label="Edit" className="h-8 w-8">
              <Pencil className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" onClick={onDelete} disabled={deleting}
              aria-label="Delete" className="h-8 w-8 text-destructive hover:text-destructive">
              {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            </Button>
          </div>
        </div>

        {expanded && (
          <div className="mt-3 space-y-2 border-t border-border pt-3">
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">
                Conditions ({rule.conditions.logic})
              </p>
              {rule.conditions.conditions.length === 0 ? (
                <p className="text-xs text-muted-foreground/60">No conditions</p>
              ) : (
                rule.conditions.conditions.map((c, i) => (
                  <p key={i} className="text-xs text-foreground/80">
                    <code className="text-primary">{c.field}</code>{" "}
                    {OPERATOR_LABELS[c.operator]}{" "}
                    <code>{String(c.value)}</code>
                    {c.value2 !== undefined && <> and <code>{c.value2}</code></>}
                  </p>
                ))
              )}
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">Actions</p>
              {rule.actions.length === 0 ? (
                <p className="text-xs text-muted-foreground/60">No actions</p>
              ) : (
                rule.actions.map((a, i) => (
                  <p key={i} className="text-xs text-foreground/80">
                    {ACTION_TYPE_LABELS[a.type]}{" "}
                    {Object.keys(a.params).length > 0 && (
                      <span className="text-muted-foreground">{JSON.stringify(a.params)}</span>
                    )}
                  </p>
                ))
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

