"use client";

import { useEffect, useState, useCallback } from "react";
import { Plus, Trash2, Loader2, Save, Tag, BookOpen } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { TagInput } from "@/components/ui/tag-input";

interface DocumentType {
  id: string;
  name: string;
  aliases: string[];
  requiredFields: string[];
  isActive: boolean;
}

type Draft = Pick<DocumentType, "name" | "aliases" | "requiredFields" | "isActive">;

const EMPTY_DRAFT: Draft = { name: "", aliases: [], requiredFields: [], isActive: true };

/** Labelled wrapper around the shared TagInput, with case-insensitive dedup. */
function LabeledTags({
  label,
  icon,
  tags,
  onChange,
  placeholder,
}: {
  label: string;
  icon: React.ReactNode;
  tags: string[];
  onChange: (tags: string[]) => void;
  placeholder: string;
}) {
  return (
    <div className="space-y-1">
      <label className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
        {icon}
        {label}
      </label>
      <TagInput
        tags={tags}
        placeholder={placeholder}
        onAdd={(v) => {
          if (!tags.some((x) => x.toLowerCase() === v.toLowerCase())) onChange([...tags, v]);
        }}
        onRemove={(i) => onChange(tags.filter((_, idx) => idx !== i))}
      />
    </div>
  );
}

export function DocumentTypesManager() {
  const [docTypes, setDocTypes] = useState<DocumentType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/document-types");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load");
      setDocTypes(
        (data.documentTypes ?? []).map((d: DocumentType) => ({
          ...d,
          aliases: (d.aliases as string[]) ?? [],
          requiredFields: (d.requiredFields as string[]) ?? [],
        }))
      );
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load document types");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function createType() {
    if (!draft.name.trim()) return;
    setCreating(true);
    try {
      const res = await fetch("/api/document-types", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to create");
      setDraft(EMPTY_DRAFT);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create document type");
    } finally {
      setCreating(false);
    }
  }

  async function saveType(dt: DocumentType) {
    setSavingId(dt.id);
    try {
      const res = await fetch(`/api/document-types/${dt.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: dt.name,
          aliases: dt.aliases,
          requiredFields: dt.requiredFields,
          isActive: dt.isActive,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to save");
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save document type");
    } finally {
      setSavingId(null);
    }
  }

  async function deleteType(id: string) {
    setSavingId(id);
    try {
      const res = await fetch(`/api/document-types/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Failed to delete");
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete document type");
    } finally {
      setSavingId(null);
    }
  }

  function patchLocal(id: string, patch: Partial<DocumentType>) {
    setDocTypes((prev) => prev.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <BookOpen className="h-4 w-4 text-muted-foreground" />
          <CardTitle className="text-base">Document Type Library</CardTitle>
        </div>
        <p className="text-xs text-muted-foreground">
          Teach the AI how each document is recognised. Add the names different hospitals use as
          aliases (e.g. &ldquo;Final Bill&rdquo;, &ldquo;Summary Bill&rdquo;, &ldquo;Hospital Statement&rdquo; for a
          Tax Invoice). Aliases are matched automatically during verification, so adding a new
          naming variant fixes missing-document false positives without losing the old ones.
          Toggle <span className="font-medium">Active</span> to retire an outdated format while keeping it recognised.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <p className="rounded-md border border-status-error/40 bg-status-error/5 px-3 py-2 text-xs text-status-error">
            {error}
          </p>
        )}

        {/* Add new */}
        <div className="space-y-2 rounded-lg border border-dashed border-border p-3">
          <Input
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            placeholder="New document type name (e.g. Summary Tax Invoice)"
            className="h-8 text-sm"
          />
          <LabeledTags
            label="Aliases"
            icon={<Tag className="h-3 w-3" />}
            tags={draft.aliases}
            onChange={(aliases) => setDraft({ ...draft, aliases })}
            placeholder="Add an alias, press Enter"
          />
          <div className="flex justify-end">
            <Button size="sm" onClick={createType} disabled={creating || !draft.name.trim()} className="h-7 text-xs">
              {creating ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Plus className="mr-1 h-3 w-3" />}
              Add document type
            </Button>
          </div>
        </div>

        {/* List */}
        {loading ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
          </div>
        ) : docTypes.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">
            No document types yet. Add the documents your claims require above.
          </p>
        ) : (
          <div className="space-y-3">
            {docTypes.map((dt) => (
              <div
                key={dt.id}
                className={`space-y-2 rounded-lg border border-border p-3 ${dt.isActive ? "" : "opacity-60"}`}
              >
                <Input
                  value={dt.name}
                  onChange={(e) => patchLocal(dt.id, { name: e.target.value })}
                  className="h-8 text-sm font-medium"
                />
                <LabeledTags
                  label="Aliases"
                  icon={<Tag className="h-3 w-3" />}
                  tags={dt.aliases}
                  onChange={(aliases) => patchLocal(dt.id, { aliases })}
                  placeholder="Add an alias, press Enter"
                />
                <LabeledTags
                  label="Key fields (for completeness check)"
                  icon={<Tag className="h-3 w-3" />}
                  tags={dt.requiredFields}
                  onChange={(requiredFields) => patchLocal(dt.id, { requiredFields })}
                  placeholder="Add a field name, press Enter"
                />
                <div className="flex items-center justify-between pt-1">
                  <button
                    type="button"
                    onClick={() => patchLocal(dt.id, { isActive: !dt.isActive })}
                    className="text-xs"
                  >
                    <Badge variant={dt.isActive ? "secondary" : "outline"} className="cursor-pointer text-xs">
                      {dt.isActive ? "Active" : "Retired"}
                    </Badge>
                  </button>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => deleteType(dt.id)}
                      disabled={savingId === dt.id}
                      className="h-7 px-2 text-xs text-muted-foreground hover:text-status-error"
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => saveType(dt)}
                      disabled={savingId === dt.id || !dt.name.trim()}
                      className="h-7 text-xs"
                    >
                      {savingId === dt.id ? (
                        <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                      ) : (
                        <Save className="mr-1 h-3 w-3" />
                      )}
                      Save
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
