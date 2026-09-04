"use client";

import { useId, useState } from "react";
import { AlertTriangle, Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TagInput } from "@/components/ui/tag-input";
import {
  cleanProviderGroupMembers,
  validateProviderGroupDraft,
  type ProviderGroupDraftIssue,
} from "@/lib/provider-group-validation";
import type { ProviderGroupMatchMode } from "@/types/portal";
import { PROVIDER_GROUP_MATCH_MODE_LABELS } from "@/types/portal";
import type { GroupWithCount } from "./provider-groups-card";

function MatchModeSelector({
  matchMode,
  onChange,
}: {
  matchMode: ProviderGroupMatchMode;
  onChange: (mode: ProviderGroupMatchMode) => void;
}) {
  return (
    <div className="space-y-1">
      <label className="text-[11px] text-muted-foreground">Match Mode</label>
      <div className="flex gap-2" role="group" aria-label="Provider group match mode">
        {(["list", "others"] as const).map((mode) => (
          <button
            type="button"
            key={mode}
            onClick={() => onChange(mode)}
            aria-pressed={matchMode === mode}
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
  );
}

function FieldSelect({
  value,
  onChange,
  fields,
  fallbackPlaceholder,
}: {
  value: string;
  onChange: (val: string) => void;
  fields: string[];
  fallbackPlaceholder?: string;
}) {
  if (fields.length > 0) {
    return (
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label="Provider match field"
        className="flex h-8 w-full rounded-md border border-border bg-background px-2 text-xs text-foreground"
      >
        {fields.map((f) => (
          <option key={f} value={f}>{f}</option>
        ))}
      </select>
    );
  }
  return (
    <Input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={fallbackPlaceholder ?? "e.g., Provider"}
      aria-label="Provider match field"
      className="h-8 text-xs"
    />
  );
}

function MembersSection({
  matchMode,
  members,
  onAdd,
  onRemove,
  describedBy,
  invalid,
}: {
  matchMode: ProviderGroupMatchMode;
  members: string[];
  onAdd: (val: string) => void;
  onRemove: (i: number) => void;
  describedBy?: string;
  invalid?: boolean;
}) {
  if (matchMode === "list") {
    return (
      <div className="space-y-1">
        <label className="text-[11px] text-muted-foreground">
          Members ({members.length})
        </label>
        <TagInput
          tags={members}
          placeholder='Type provider name and press Enter'
          onAdd={onAdd}
          onRemove={onRemove}
          ariaLabel="Provider group members"
          ariaDescribedBy={describedBy}
          invalid={invalid}
        />
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Use the stable organization name. Capitalization, punctuation, legal suffixes, apostrophe style,
          and “&”/“and” variations are handled automatically.
        </p>
      </div>
    );
  }
  return (
    <p className="text-[10px] text-muted-foreground italic">
      This group will match any provider not matched by other &quot;list&quot; mode groups.
    </p>
  );
}

function ValidationMessages({ id, issues }: { id: string; issues: ProviderGroupDraftIssue[] }) {
  if (issues.length === 0) return null;
  return (
    <div
      id={id}
      role="status"
      aria-live="polite"
      className="flex items-start gap-2 rounded-md border border-status-warning/40 bg-status-warning/10 px-3 py-2 text-xs text-foreground/85"
    >
      <AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-status-warning" />
      <div>
        <p className="font-medium text-foreground">Complete this group before saving:</p>
        <ul className="mt-1 list-disc space-y-0.5 pl-4">
          {issues.map((issue) => <li key={issue.code}>{issue.message}</li>)}
        </ul>
      </div>
    </div>
  );
}

export function AddGroupForm({
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
  const formId = useId();
  const [name, setName] = useState("");
  const [providerFieldName, setProviderFieldName] = useState(availableFields[0] ?? "");
  const [matchMode, setMatchMode] = useState<ProviderGroupMatchMode>("list");
  const [members, setMembers] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const issues = validateProviderGroupDraft({ name, providerFieldName, matchMode, members });
  const memberInvalid = issues.some((issue) =>
    issue.code === "EMPTY_LIST" || issue.code === "DUPLICATE_MEMBER"
  );

  async function handleSave() {
    if (issues.length > 0) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/portals/${portalId}/provider-groups`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          providerFieldName,
          matchMode,
          members: cleanProviderGroupMembers(members),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? data.message ?? "Failed to save");
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

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div className="space-y-1">
          <label className="text-[11px] text-muted-foreground">Group Name</label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g., Government Hospital"
            aria-label="Provider group name"
            className="h-8 text-xs"
          />
        </div>
        <div className="space-y-1">
          <label className="text-[11px] text-muted-foreground">Match Field</label>
          <FieldSelect
            value={providerFieldName}
            onChange={setProviderFieldName}
            fields={availableFields}
          />
        </div>
      </div>

      <MatchModeSelector matchMode={matchMode} onChange={setMatchMode} />

      <MembersSection
        matchMode={matchMode}
        members={members}
        onAdd={(val) => { if (!members.includes(val)) setMembers((prev) => [...prev, val]); }}
        onRemove={(i) => setMembers((prev) => prev.filter((_, idx) => idx !== i))}
        describedBy={issues.length > 0 ? `${formId}-validation` : undefined}
        invalid={memberInvalid}
      />

      <ValidationMessages id={`${formId}-validation`} issues={issues} />

      <div className="flex items-center justify-end gap-2 pt-1">
        <Button variant="ghost" size="sm" onClick={onCancel} className="h-7 text-xs">Cancel</Button>
        <Button size="sm" onClick={handleSave} disabled={saving || issues.length > 0} className="h-7 text-xs">
          {saving ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Check className="h-3 w-3 mr-1" />}
          Save
        </Button>
      </div>
    </div>
  );
}

export function EditGroupForm({
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
  const formId = useId();
  const [name, setName] = useState(group.name);
  const [providerFieldName, setProviderFieldName] = useState(group.providerFieldName);
  const [matchMode, setMatchMode] = useState<ProviderGroupMatchMode>(group.matchMode);
  const [members, setMembers] = useState<string[]>(group.members);
  const [saving, setSaving] = useState(false);

  const allFields = availableFields.includes(group.providerFieldName)
    ? availableFields
    : [group.providerFieldName, ...availableFields];
  const issues = validateProviderGroupDraft({ name, providerFieldName, matchMode, members });
  const memberInvalid = issues.some((issue) =>
    issue.code === "EMPTY_LIST" || issue.code === "DUPLICATE_MEMBER"
  );

  async function handleSave() {
    if (issues.length > 0) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/portals/${portalId}/provider-groups/${group.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          providerFieldName,
          matchMode,
          members: cleanProviderGroupMembers(members),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? data.message ?? "Failed to save");
      }
      onSaved({
        ...group,
        name: name.trim(),
        providerFieldName,
        matchMode,
        members: cleanProviderGroupMembers(members),
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

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div className="space-y-1">
          <label className="text-[11px] text-muted-foreground">Group Name</label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-label="Provider group name"
            className="h-8 text-xs"
          />
        </div>
        <div className="space-y-1">
          <label className="text-[11px] text-muted-foreground">Match Field</label>
          <FieldSelect
            value={providerFieldName}
            onChange={setProviderFieldName}
            fields={allFields}
          />
        </div>
      </div>

      <MatchModeSelector matchMode={matchMode} onChange={setMatchMode} />

      <MembersSection
        matchMode={matchMode}
        members={members}
        onAdd={(val) => { if (!members.includes(val)) setMembers((prev) => [...prev, val]); }}
        onRemove={(i) => setMembers((prev) => prev.filter((_, idx) => idx !== i))}
        describedBy={issues.length > 0 ? `${formId}-validation` : undefined}
        invalid={memberInvalid}
      />

      <ValidationMessages id={`${formId}-validation`} issues={issues} />

      <div className="flex items-center justify-end gap-2 pt-1">
        <Button variant="ghost" size="sm" onClick={onCancel} className="h-7 text-xs">Cancel</Button>
        <Button size="sm" onClick={handleSave} disabled={saving || issues.length > 0} className="h-7 text-xs">
          {saving ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Check className="h-3 w-3 mr-1" />}
          Save
        </Button>
      </div>
    </div>
  );
}
