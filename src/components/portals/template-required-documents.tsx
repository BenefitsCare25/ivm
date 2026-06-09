"use client";

import { useState, useEffect, useId } from "react";
import Link from "next/link";
import { Plus, Trash2, Loader2, Save, AlertTriangle, CheckCircle2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { RequiredDocument, RequiredDocumentRule } from "@/types/portal";

const RULES: { value: RequiredDocumentRule; label: string }[] = [
  { value: "required", label: "Required" },
  { value: "one_of", label: "One of group" },
];

interface LibraryType {
  id: string;
  name: string;
  aliases: string[];
  isActive: boolean;
}

interface Props {
  requiredDocuments: RequiredDocument[];
  saving: boolean;
  onSave: (requiredDocuments: RequiredDocument[]) => void;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

export function TemplateRequiredDocuments({ requiredDocuments: initial, saving, onSave }: Props) {
  const [docs, setDocs] = useState<RequiredDocument[]>(initial);
  const [library, setLibrary] = useState<LibraryType[]>([]);
  const listId = useId();

  useEffect(() => {
    let cancelled = false;
    fetch("/api/document-types")
      .then((r) => (r.ok ? r.json() : { documentTypes: [] }))
      .then((data) => {
        if (cancelled) return;
        const types: LibraryType[] = (data.documentTypes ?? [])
          .map((d: LibraryType) => ({
            id: d.id,
            name: d.name,
            aliases: (d.aliases as string[]) ?? [],
            isActive: d.isActive,
          }))
          .filter((d: LibraryType) => d.isActive);
        setLibrary(types);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const libByNorm = new Map(library.map((d) => [norm(d.name), d]));

  function addDoc() {
    setDocs((prev) => [...prev, { documentTypeName: "", rule: "required" }]);
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

  // Names that don't match any active library entry → only family/LLM matching,
  // not the confident alias-based match.
  const unmatched = docs
    .filter((d) => d.documentTypeName.trim() && !libByNorm.has(norm(d.documentTypeName)))
    .map((d) => d.documentTypeName.trim());

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
          Documents the AI must find among uploaded files. Pick a name from your{" "}
          <Link href="/settings" className="underline hover:text-foreground">
            Document Type Library
          </Link>{" "}
          so aliases are matched. Missing docs are flagged as REQUIRED_DOCUMENT failures.
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
            {docs.map((d, idx) => {
              const matched = d.documentTypeName.trim()
                ? libByNorm.get(norm(d.documentTypeName))
                : undefined;
              return (
                <div key={idx} className="space-y-0.5">
                  <div className="grid grid-cols-[1fr_110px_80px_28px] gap-1.5 items-center">
                    <Input
                      list={listId}
                      value={d.documentTypeName}
                      onChange={(e) => updateDoc(idx, { documentTypeName: e.target.value })}
                      placeholder="e.g. Tax Invoice"
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
                  {d.documentTypeName.trim() && (
                    <p className="px-1 text-[10px] flex items-center gap-1">
                      {matched ? (
                        <span className="flex items-center gap-1 text-emerald-600">
                          <CheckCircle2 className="h-3 w-3" />
                          Matches library{matched.aliases.length > 0 ? ` · ${matched.aliases.length} alias${matched.aliases.length > 1 ? "es" : ""}` : ""}
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-amber-600">
                          <AlertTriangle className="h-3 w-3" />
                          Not in library — relies on built-in/LLM matching only
                        </span>
                      )}
                    </p>
                  )}
                </div>
              );
            })}

            <datalist id={listId}>
              {library.map((d) => (
                <option key={d.id} value={d.name} />
              ))}
            </datalist>

            {unmatched.length > 0 && (
              <p className="rounded-md border border-amber-400/40 bg-amber-400/5 px-2.5 py-1.5 text-[11px] text-amber-700">
                {unmatched.length} document name{unmatched.length > 1 ? "s" : ""} not in your library
                ({unmatched.join(", ")}). Add{" "}
                {unmatched.length > 1 ? "them" : "it"} in{" "}
                <Link href="/settings" className="underline">
                  Document Recognition
                </Link>{" "}
                to control which hospital titles count.
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
