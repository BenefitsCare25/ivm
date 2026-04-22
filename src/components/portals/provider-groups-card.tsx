"use client";

import { useState, useEffect } from "react";
import { Users, Loader2, Trash2, Plus, Pencil } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FormError } from "@/components/ui/form-error";
import type { ProviderGroupSummary } from "@/types/portal";
import { PROVIDER_GROUP_MATCH_MODE_LABELS } from "@/types/portal";
import { AddGroupForm, EditGroupForm } from "./provider-group-forms";

export interface GroupWithCount extends ProviderGroupSummary {
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
