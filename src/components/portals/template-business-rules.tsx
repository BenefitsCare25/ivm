"use client";

import { useState, useEffect } from "react";
import { Plus, Trash2, Loader2, Save, ChevronDown, ChevronUp, Eye } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { BusinessRule, BusinessRuleSeverity, BusinessRuleType, CodeRuleOperator } from "@/types/portal";
import { CODE_RULE_OPERATORS, CODE_RULE_OPERATOR_LABELS, CODE_RULE_BINARY_OPERATORS } from "@/types/portal";
import { generateId } from "@/lib/utils";

const SEVERITIES: { value: BusinessRuleSeverity; label: string }[] = [
  { value: "critical", label: "Critical" },
  { value: "warning", label: "Warning" },
  { value: "info", label: "Info" },
];

const FIELD_DATALIST_ID = "br-available-fields";

interface Props {
  businessRules: BusinessRule[];
  saving: boolean;
  onSave: (businessRules: BusinessRule[]) => void;
  availableFields?: string[];
}

export function TemplateBusinessRules({ businessRules: initial, saving, onSave, availableFields }: Props) {
  const [rules, setRules] = useState<BusinessRule[]>(initial);
  const [fieldsExpanded, setFieldsExpanded] = useState(false);

  useEffect(() => { setRules(initial); }, [initial]);

  function addRule(type: BusinessRuleType) {
    setRules((prev) => [
      ...prev,
      { id: generateId(), rule: "", category: "", severity: "warning", type },
    ]);
  }

  function removeRule(idx: number) {
    setRules((prev) => prev.filter((_, i) => i !== idx));
  }

  function updateRule(idx: number, patch: Partial<BusinessRule>) {
    setRules((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }

  function handleSave() {
    const valid = rules
      .filter((r) =>
        (r.type ?? "ai") === "code"
          ? !!r.field?.trim() && !!r.operator
          : r.rule.trim()
      )
      .map((r) => ({
        ...r,
        rule: r.rule.trim(),
        category: r.category.trim() || "General",
      }));
    onSave(valid);
  }

  return (
    <Card className="lg:col-span-2">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Business Rules</CardTitle>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => addRule("ai")} className="h-7 text-xs px-2">
              <Plus className="mr-1 h-3 w-3" />
              AI rule
            </Button>
            <Button size="sm" variant="outline" onClick={() => addRule("code")} className="h-7 text-xs px-2">
              <Plus className="mr-1 h-3 w-3" />
              Code rule
            </Button>
            <Button size="sm" onClick={handleSave} disabled={saving} className="h-7 text-xs px-2">
              {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3 mr-1" />}
              Save
            </Button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          <strong>AI rules</strong> are judged by the model from a description; <strong>Code rules</strong> are exact
          field checks evaluated deterministically. <strong>Severity</strong> controls escalation: Critical & Warning
          flag the item, Info is recorded only. Toggle <Eye className="inline h-3 w-3" /> to re-verify a flagged AI rule
          against the source document with vision.
        </p>
        {availableFields && availableFields.length > 0 && (
          <div className="mt-2">
            <button
              onClick={() => setFieldsExpanded(!fieldsExpanded)}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              {fieldsExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              Available portal fields ({availableFields.length})
            </button>
            {fieldsExpanded && (
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {availableFields.map((f) => (
                  <span
                    key={f}
                    className="inline-flex items-center rounded-md border border-border bg-muted/50 px-2 py-0.5 text-xs font-mono text-foreground"
                  >
                    {f}
                  </span>
                ))}
              </div>
            )}
            {fieldsExpanded && (
              <p className="mt-1 text-[10px] text-muted-foreground/60">
                Use these exact field names in your rules so the AI can match them.
              </p>
            )}
          </div>
        )}
      </CardHeader>
      <CardContent className="space-y-2">
        {/* Shared datalist of known fields for code-rule field pickers */}
        {availableFields && availableFields.length > 0 && (
          <datalist id={FIELD_DATALIST_ID}>
            {availableFields.map((f) => (
              <option key={f} value={f} />
            ))}
          </datalist>
        )}

        {rules.length === 0 ? (
          <p className="text-xs text-muted-foreground py-4 text-center">
            No business rules configured.
          </p>
        ) : (
          rules.map((r, idx) => {
            const type = r.type ?? "ai";
            const isBinary = r.operator ? CODE_RULE_BINARY_OPERATORS.includes(r.operator) : false;
            return (
              <div key={r.id} className="rounded-lg border border-border p-2.5 space-y-2">
                {/* Header row: type badge + category + severity + vision + delete */}
                <div className="flex items-center gap-1.5">
                  <span
                    className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${
                      type === "code"
                        ? "bg-status-info/10 text-status-info"
                        : "bg-accent/10 text-accent"
                    }`}
                  >
                    {type === "code" ? "CODE" : "AI"}
                  </span>
                  <Input
                    value={r.category}
                    onChange={(e) => updateRule(idx, { category: e.target.value })}
                    placeholder="Category"
                    className="h-7 text-xs flex-1"
                  />
                  <select
                    value={r.severity}
                    onChange={(e) => updateRule(idx, { severity: e.target.value as BusinessRuleSeverity })}
                    className="h-7 w-[90px] text-xs rounded-md border border-border bg-background px-1.5 text-foreground"
                  >
                    {SEVERITIES.map((s) => (
                      <option key={s.value} value={s.value}>{s.label}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => updateRule(idx, { verifyWithVision: !r.verifyWithVision })}
                    title={r.verifyWithVision ? "Vision re-check ON — a flagged result is re-verified against the document" : "Enable vision re-check when flagged"}
                    aria-pressed={r.verifyWithVision ?? false}
                    className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md border transition-colors ${
                      r.verifyWithVision
                        ? "border-accent bg-accent/10 text-accent"
                        : "border-border text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    <Eye className="h-3.5 w-3.5" />
                  </button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => removeRule(idx)}
                    className="h-7 w-7 shrink-0 p-0 text-muted-foreground hover:text-status-error"
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>

                {type === "ai" ? (
                  <textarea
                    value={r.rule}
                    onChange={(e) => updateRule(idx, { rule: e.target.value })}
                    placeholder="e.g. Invoice date must not be earlier than admission date"
                    rows={2}
                    className="text-xs rounded-md border border-border bg-background px-2.5 py-1.5 text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:ring-1 focus:ring-ring w-full"
                  />
                ) : (
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-1.5">
                      <input
                        list={FIELD_DATALIST_ID}
                        value={r.field ?? ""}
                        onChange={(e) => updateRule(idx, { field: e.target.value })}
                        placeholder="Field (e.g. Outstanding Balance)"
                        className="h-7 flex-1 text-xs rounded-md border border-border bg-background px-2 text-foreground"
                      />
                      <select
                        value={r.operator ?? ""}
                        onChange={(e) => {
                          const op = (e.target.value || undefined) as CodeRuleOperator | undefined;
                          const patch: Partial<BusinessRule> = { operator: op };
                          // Unary operators take no value — clear any previously-typed comparison.
                          if (op && !CODE_RULE_BINARY_OPERATORS.includes(op)) {
                            patch.value = undefined;
                            patch.compareField = undefined;
                          }
                          updateRule(idx, patch);
                        }}
                        className="h-7 w-[150px] text-xs rounded-md border border-border bg-background px-1.5 text-foreground"
                      >
                        <option value="">operator…</option>
                        {CODE_RULE_OPERATORS.map((op) => (
                          <option key={op} value={op}>{CODE_RULE_OPERATOR_LABELS[op]}</option>
                        ))}
                      </select>
                    </div>
                    {isBinary && (
                      <div className="flex items-center gap-1.5">
                        <Input
                          value={r.value ?? ""}
                          onChange={(e) => updateRule(idx, { value: e.target.value })}
                          placeholder="Value (e.g. 0)"
                          className="h-7 text-xs flex-1"
                          disabled={!!r.compareField?.trim()}
                        />
                        <span className="text-[10px] text-muted-foreground">or field</span>
                        <input
                          list={FIELD_DATALIST_ID}
                          value={r.compareField ?? ""}
                          onChange={(e) => updateRule(idx, { compareField: e.target.value })}
                          placeholder="Compare to field…"
                          className="h-7 flex-1 text-xs rounded-md border border-border bg-background px-2 text-foreground"
                        />
                      </div>
                    )}
                    <Input
                      value={r.rule}
                      onChange={(e) => updateRule(idx, { rule: e.target.value })}
                      placeholder="Optional label (defaults to the field check)"
                      className="h-7 text-xs"
                    />
                  </div>
                )}
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
