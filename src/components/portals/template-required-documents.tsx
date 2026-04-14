"use client";

import { useState } from "react";
import { Plus, Trash2, Loader2, Save } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { RequiredDocument, RequiredDocumentRule } from "@/types/portal";

const RULES: { value: RequiredDocumentRule; label: string }[] = [
  { value: "required", label: "Required" },
  { value: "one_of", label: "One of group" },
];

interface Props {
  requiredDocuments: RequiredDocument[];
  saving: boolean;
  onSave: (requiredDocuments: RequiredDocument[]) => void;
}

export function TemplateRequiredDocuments({ requiredDocuments: initial, saving, onSave }: Props) {
  const [docs, setDocs] = useState<RequiredDocument[]>(initial);

  function addDoc() {
    setDocs((prev) => [
      ...prev,
      { documentTypeName: "", rule: "required" },
    ]);
  }

  function removeDoc(idx: number) {
    setDocs((prev) => prev.filter((_, i) => i !== idx));
  }

  function updateDoc(idx: number, patch: Partial<RequiredDocument>) {
    setDocs((prev) => prev.map((d, i) => (i === idx ? { ...d, ...patch } : d)));
  }

  function handleSave() {
    const valid = docs.filter((d) => d.documentTypeName.trim());
    onSave(valid);
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Required Documents</CardTitle>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={addDoc} className="h-7 text-xs px-2">
              <Plus className="mr-1 h-3 w-3" />
              Add
            </Button>
            <Button size="sm" onClick={handleSave} disabled={saving} className="h-7 text-xs px-2">
              {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3 mr-1" />}
              Save
            </Button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Documents the AI must find among uploaded files. Missing docs are flagged as REQUIRED_DOCUMENT failures.
        </p>
      </CardHeader>
      <CardContent className="space-y-2">
        {docs.length === 0 ? (
          <p className="text-xs text-muted-foreground py-4 text-center">
            No required documents configured.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-[1fr_110px_80px_28px] gap-1.5 text-xs font-medium text-muted-foreground px-1">
              <span>Document type name</span>
              <span>Rule</span>
              <span>Group</span>
              <span />
            </div>
            {docs.map((d, idx) => (
              <div key={idx} className="grid grid-cols-[1fr_110px_80px_28px] gap-1.5 items-center">
                <Input
                  value={d.documentTypeName}
                  onChange={(e) => updateDoc(idx, { documentTypeName: e.target.value })}
                  placeholder="e.g. Specialist Letter"
                  className="h-7 text-xs"
                />
                <select
                  value={d.rule}
                  onChange={(e) => updateDoc(idx, { rule: e.target.value as RequiredDocumentRule })}
                  className="h-7 text-xs rounded-md border border-border bg-background px-1.5 text-foreground"
                >
                  {RULES.map((r) => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                </select>
                <Input
                  value={d.group ?? ""}
                  onChange={(e) => updateDoc(idx, { group: e.target.value || undefined })}
                  placeholder="optional"
                  className="h-7 text-xs"
                />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => removeDoc(idx)}
                  className="h-7 w-7 p-0 text-muted-foreground hover:text-status-error"
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
