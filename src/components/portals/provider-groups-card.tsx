"use client";

import { useState, useEffect, useRef, type KeyboardEvent } from "react";
import { Users, X, Loader2, Trash2, Plus, Pencil, Check } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { FormError } from "@/components/ui/form-error";
import type { ProviderGroupSummary, ProviderGroupMatchMode } from "@/types/portal";
import { PROVIDER_GROUP_MATCH_MODE_LABELS } from "@/types/portal";

function TagInput({
  tags,
  placeholder,
  onAdd,
  onRemove,
}: {
  tags: string[];
  placeholder: string;
  onAdd: (value: string) => void;
  onRemove: (index: number) => void;
}) {
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  function commit() {
    const val = input.trim();
    if (!val) return;
    onAdd(val);
    setInput("");
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      commit();
    } else if (e.key === "Backspace" && input === "" && tags.length > 0) {
      onRemove(tags.length - 1);
    }
  }

  return (
    <div
      className="min-h-9 flex flex-wrap items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1.5 cursor-text"
      onClick={() => inputRef.current?.focus()}
    >
      {tags.map((tag, i) => (
        <span
          key={i}
          className="inline-flex items-center gap-1 rounded bg-muted px-2 py-0.5 text-xs font-medium text-foreground"
        >
          {tag}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onRemove(i); }}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      <Input
        ref={inputRef}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={commit}
        placeholder={tags.length === 0 ? placeholder : ""}
        className="h-auto flex-1 min-w-24 border-none bg-transparent p-0 text-xs shadow-none focus-visible:ring-0 placeholder:text-muted-foreground/60"
      />
    </div>
  );
}

interface GroupWithCount extends ProviderGroupSummary {
  templateCount: number;
}

interface Props {
  portalId: string;
  availableFields: string[];
}

export function ProviderGroupsCard({ portalId, availableFields }: Props) {
  const [groups, setGroups] = useState<GroupWithCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/portals/${portalId}/provider-groups`)
      .then((r) => r.json())
      .then((data) => { if (Array.isArray(data)) setGroups(data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [portalId]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-sm font-medium">Provider Groups</CardTitle>
            {groups.length > 0 && (
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                {groups.length}
              </span>
            )}
          </div>
          {!showAddForm && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setShowAddForm(true)}
              className="h-7 text-xs px-2"
            >
              <Plus className="h-3 w-3 mr-1" /> Add Group
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">
          Classify providers (e.g., hospitals) into groups so templates with the same claim type can apply different rules per group.
        </p>
      </CardHeader>

      <CardContent className="space-y-3">
        {loading && (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        )}

        {error && <FormError message={error} />}

        {!loading && groups.length === 0 && !showAddForm && (
          <p className="text-xs text-muted-foreground text-center py-2">
            No provider groups configured.
          </p>
        )}

        {groups.map((group) =>
          editingId === group.id ? (
            <EditGroupForm
              key={group.id}
              group={group}
              availableFields={availableFields}
              portalId={portalId}
              onSaved={(updated) => {
                setGroups((prev) => prev.map((g) => (g.id === updated.id ? updated : g)));
                setEditingId(null);
                setError(null);
              }}
              onCancel={() => setEditingId(null)}
              onError={setError}
            />
          ) : (
            <GroupRow
              key={group.id}
              group={group}
              portalId={portalId}
              onEdit={() => setEditingId(group.id)}
              onDeleted={(id) => {
                setGroups((prev) => prev.filter((g) => g.id !== id));
                setError(null);
              }}
              onError={setError}
            />
          )
        )}

        {showAddForm && (
          <AddGroupForm
            availableFields={availableFields}
            portalId={portalId}
            onSaved={(group) => {
              setGroups((prev) => [...prev, group]);
              setShowAddForm(false);
              setError(null);
            }}
            onCancel={() => setShowAddForm(false)}
            onError={setError}
          />
        )}
      </CardContent>
    </Card>
  );
}

function GroupRow({
  group,
  portalId,
  onEdit,
  onDeleted,
  onError,
}: {
  group: GroupWithCount;
  portalId: string;
  onEdit: () => void;
  onDeleted: (id: string) => void;
  onError: (msg: string) => void;
}) {
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    if (!confirm(`Delete provider group "${group.name}"? Templates using it will become ungrouped.`)) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/portals/${portalId}/provider-groups/${group.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete");
      onDeleted(group.id);
    } catch {
      onError("Failed to delete provider group");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="rounded-lg border border-border p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-medium text-foreground truncate">{group.name}</span>
          <Badge variant="outline" className="text-[10px] shrink-0">
            {PROVIDER_GROUP_MATCH_MODE_LABELS[group.matchMode]}
          </Badge>
          {group.templateCount > 0 && (
            <span className="text-[10px] text-muted-foreground shrink-0">
              {group.templateCount} template{group.templateCount !== 1 ? "s" : ""}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button onClick={onEdit} className="text-muted-foreground hover:text-foreground p-1 cursor-pointer">
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button onClick={handleDelete} disabled={deleting} className="text-muted-foreground hover:text-destructive p-1 cursor-pointer">
            {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>

      <div className="text-xs text-muted-foreground">
        Field: <span className="font-mono text-foreground">{group.providerFieldName}</span>
      </div>

      {group.matchMode === "list" && group.members.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {group.members.slice(0, 6).map((m, i) => (
            <span key={i} className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-foreground">
              {m}
            </span>
          ))}
          {group.members.length > 6 && (
            <span className="text-[10px] text-muted-foreground self-center">
              +{group.members.length - 6} more
            </span>
          )}
        </div>
      )}

      {group.matchMode === "others" && (
        <p className="text-[10px] text-muted-foreground italic">
          Matches any provider not matched by other &quot;list&quot; groups
        </p>
      )}
    </div>
  );
}

function AddGroupForm({
  availableFields,
  portalId,
  onSaved,
  onCancel,
  onError,
}: {
  availableFields: string[];
  portalId: string;
  onSaved: (group: GroupWithCount) => void;
  onCancel: () => void;
  onError: (msg: string) => void;
}) {
  const [name, setName] = useState("");
  const [providerFieldName, setProviderFieldName] = useState(availableFields[0] ?? "");
  const [matchMode, setMatchMode] = useState<ProviderGroupMatchMode>("list");
  const [members, setMembers] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!name.trim() || !providerFieldName) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/portals/${portalId}/provider-groups`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), providerFieldName, matchMode, members }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message ?? "Failed to save");
      }
      const group = await res.json();
      onSaved(group);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to save");
      setSaving(false);
    }
  }

  return (
    <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-3">
      <p className="text-xs font-medium text-foreground">New Provider Group</p>

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <label className="text-[11px] text-muted-foreground">Group Name</label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g., Government Hospital"
            className="h-8 text-xs"
          />
        </div>
        <div className="space-y-1">
          <label className="text-[11px] text-muted-foreground">Match Field</label>
          {availableFields.length > 0 ? (
            <select
              value={providerFieldName}
              onChange={(e) => setProviderFieldName(e.target.value)}
              className="flex h-8 w-full rounded-md border border-border bg-background px-2 text-xs text-foreground"
            >
              {availableFields.map((f) => (
                <option key={f} value={f}>{f}</option>
              ))}
            </select>
          ) : (
            <Input
              value={providerFieldName}
              onChange={(e) => setProviderFieldName(e.target.value)}
              placeholder="e.g., Provider"
              className="h-8 text-xs"
            />
          )}
        </div>
      </div>

      <div className="space-y-1">
        <label className="text-[11px] text-muted-foreground">Match Mode</label>
        <div className="flex gap-2">
          {(["list", "others"] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => setMatchMode(mode)}
              className={`rounded-md border px-3 py-1.5 text-xs transition-colors cursor-pointer ${
                matchMode === mode
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              {PROVIDER_GROUP_MATCH_MODE_LABELS[mode]}
            </button>
          ))}
        </div>
      </div>

      {matchMode === "list" && (
        <div className="space-y-1">
          <label className="text-[11px] text-muted-foreground">
            Members ({members.length})
          </label>
          <TagInput
            tags={members}
            placeholder='Type provider name and press Enter'
            onAdd={(val) => { if (!members.includes(val)) setMembers((prev) => [...prev, val]); }}
            onRemove={(i) => setMembers((prev) => prev.filter((_, idx) => idx !== i))}
          />
        </div>
      )}

      {matchMode === "others" && (
        <p className="text-[10px] text-muted-foreground italic">
          This group will match any provider not matched by other &quot;list&quot; mode groups sharing the same claim type.
        </p>
      )}

      <div className="flex items-center justify-end gap-2 pt-1">
        <Button variant="ghost" size="sm" onClick={onCancel} className="h-7 text-xs">Cancel</Button>
        <Button size="sm" onClick={handleSave} disabled={saving || !name.trim() || !providerFieldName} className="h-7 text-xs">
          {saving ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Check className="h-3 w-3 mr-1" />}
          Save
        </Button>
      </div>
    </div>
  );
}

function EditGroupForm({
  group,
  availableFields,
  portalId,
  onSaved,
  onCancel,
  onError,
}: {
  group: GroupWithCount;
  availableFields: string[];
  portalId: string;
  onSaved: (updated: GroupWithCount) => void;
  onCancel: () => void;
  onError: (msg: string) => void;
}) {
  const [name, setName] = useState(group.name);
  const [providerFieldName, setProviderFieldName] = useState(group.providerFieldName);
  const [matchMode, setMatchMode] = useState<ProviderGroupMatchMode>(group.matchMode);
  const [members, setMembers] = useState<string[]>(group.members);
  const [saving, setSaving] = useState(false);

  const allFields = availableFields.includes(group.providerFieldName)
    ? availableFields
    : [group.providerFieldName, ...availableFields];

  async function handleSave() {
    if (!name.trim() || !providerFieldName) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/portals/${portalId}/provider-groups/${group.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), providerFieldName, matchMode, members }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message ?? "Failed to save");
      }
      onSaved({
        ...group,
        name: name.trim(),
        providerFieldName,
        matchMode,
        members,
        updatedAt: new Date().toISOString(),
      });
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to save");
      setSaving(false);
    }
  }

  return (
    <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-3">
      <p className="text-xs font-medium text-foreground">Edit: {group.name}</p>

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <label className="text-[11px] text-muted-foreground">Group Name</label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="h-8 text-xs"
          />
        </div>
        <div className="space-y-1">
          <label className="text-[11px] text-muted-foreground">Match Field</label>
          {allFields.length > 0 ? (
            <select
              value={providerFieldName}
              onChange={(e) => setProviderFieldName(e.target.value)}
              className="flex h-8 w-full rounded-md border border-border bg-background px-2 text-xs text-foreground"
            >
              {allFields.map((f) => (
                <option key={f} value={f}>{f}</option>
              ))}
            </select>
          ) : (
            <Input
              value={providerFieldName}
              onChange={(e) => setProviderFieldName(e.target.value)}
              className="h-8 text-xs"
            />
          )}
        </div>
      </div>

      <div className="space-y-1">
        <label className="text-[11px] text-muted-foreground">Match Mode</label>
        <div className="flex gap-2">
          {(["list", "others"] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => setMatchMode(mode)}
              className={`rounded-md border px-3 py-1.5 text-xs transition-colors cursor-pointer ${
                matchMode === mode
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              {PROVIDER_GROUP_MATCH_MODE_LABELS[mode]}
            </button>
          ))}
        </div>
      </div>

      {matchMode === "list" && (
        <div className="space-y-1">
          <label className="text-[11px] text-muted-foreground">
            Members ({members.length})
          </label>
          <TagInput
            tags={members}
            placeholder='Type provider name and press Enter'
            onAdd={(val) => { if (!members.includes(val)) setMembers((prev) => [...prev, val]); }}
            onRemove={(i) => setMembers((prev) => prev.filter((_, idx) => idx !== i))}
          />
        </div>
      )}

      {matchMode === "others" && (
        <p className="text-[10px] text-muted-foreground italic">
          This group will match any provider not matched by other &quot;list&quot; mode groups.
        </p>
      )}

      <div className="flex items-center justify-end gap-2 pt-1">
        <Button variant="ghost" size="sm" onClick={onCancel} className="h-7 text-xs">Cancel</Button>
        <Button size="sm" onClick={handleSave} disabled={saving || !name.trim() || !providerFieldName} className="h-7 text-xs">
          {saving ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Check className="h-3 w-3 mr-1" />}
          Save
        </Button>
      </div>
    </div>
  );
}
