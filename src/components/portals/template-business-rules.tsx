"use client";

import { useState } from "react";
import { Plus, Trash2, Loader2, Save } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { BusinessRule, BusinessRuleSeverity } from "@/types/portal";
import { generateId } from "@/lib/utils";

const SEVERITIES: { value: BusinessRuleSeverity; label: string }[] = [
  { value: "warning", label: "Warning" },
  { value: "critical", label: "Critical" },
  { value: "info", label: "Info" },
];

interface Props {
  businessRules: BusinessRule[];
  saving: boolean;
  onSave: (businessRules: BusinessRule[]) => void;
}

export function TemplateBusinessRules({ businessRules: initial, saving, onSave }: Props) {
  const [rules, setRules] = useState<BusinessRule[]>(initial);

  function addRule() {
    setRules((prev) => [
      ...prev,
      { id: generateId(), rule: "", category: "", severity: "warning" },
    ]);
  }

  function removeRule(idx: number) {
    setRules((prev) => prev.filter((_, i) => i !== idx));
  }

  function updateRule(idx: number, patch: Partial<BusinessRule>) {
    setRules((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }

  function handleSave() {
    const valid = rules.filter((r) => r.rule.trim() && r.category.trim());
    onSave(valid);
  }

  return (
    <Card className="lg:col-span-2">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Business Rules</CardTitle>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={addRule} className="h-7 text-xs px-2">
              <Plus className="mr-1 h-3 w-3" />
              Add rule
            </Button>
            <Button size="sm" onClick={handleSave} disabled={saving} className="h-7 text-xs px-2">
              {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3 mr-1" />}
              Save
            </Button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Rules the AI evaluates against the claim data. Failures appear as BUSINESS_RULE alerts on items.
        </p>
      </CardHeader>
      <CardContent className="space-y-2">
        {rules.length === 0 ? (
          <p className="text-xs text-muted-foreground py-4 text-center">
            No business rules configured.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-[1fr_120px_90px_28px] gap-1.5 text-xs font-medium text-muted-foreground px-1">
              <span>Rule description</span>
              <span>Category</span>
              <span>Severity</span>
              <span />
            </div>
            {rules.map((r, idx) => (
              <div key={r.id} className="grid grid-cols-[1fr_120px_90px_28px] gap-1.5 items-start">
                <textarea
                  value={r.rule}
                  onChange={(e) => updateRule(idx, { rule: e.target.value })}
                  placeholder="e.g. Invoice date must not be earlier than admission date"
                  rows={2}
                  className="text-xs rounded-md border border-border bg-background px-2.5 py-1.5 text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:ring-1 focus:ring-ring w-full"
                />
                <Input
                  value={r.category}
                  onChange={(e) => updateRule(idx, { category: e.target.value })}
                  placeholder="e.g. Date Validation"
                  className="h-7 text-xs"
                />
                <select
                  value={r.severity}
                  onChange={(e) => updateRule(idx, { severity: e.target.value as BusinessRuleSeverity })}
                  className="h-7 text-xs rounded-md border border-border bg-background px-1.5 text-foreground"
                >
                  {SEVERITIES.map((s) => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </select>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => removeRule(idx)}
                  className="h-7 w-7 p-0 text-muted-foreground hover:text-status-error mt-0.5"
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            ))}
          </>
        )}
      </CardContent>
    </Card>
  );
}
