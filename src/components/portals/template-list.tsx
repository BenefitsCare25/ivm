"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Trash2, Loader2, FileSliders, ExternalLink, Plus, CheckCircle2, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { ComparisonTemplateSummary, DetectedClaimType, ProviderGroupSummary } from "@/types/portal";

function getFieldDisplayName(f: { portalFieldName?: string; fieldName?: string }, i: number): string {
  return f.portalFieldName ?? f.fieldName ?? `field-${i}`;
}

interface TemplateListProps {
  portalId: string;
  configId: string;
  groupingFields: string[];
  detectedClaimTypes: DetectedClaimType[];
  availableFields: string[];
  refreshKey?: number;
}

export function TemplateList({
  portalId,
  configId,
  groupingFields,
  detectedClaimTypes,
  availableFields: _availableFields,
  refreshKey,
}: TemplateListProps) {
  const router = useRouter();
  const [templates, setTemplates] = useState<ComparisonTemplateSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [creating, setCreating] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [addName, setAddName] = useState("");
  const [addProviderGroupId, setAddProviderGroupId] = useState<string | null>(null);
  const [providerGroups, setProviderGroups] = useState<ProviderGroupSummary[]>([]);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetch(`/api/portals/${portalId}/templates?configId=${configId}`).then((r) => r.json()),
      fetch(`/api/portals/${portalId}/provider-groups`).then((r) => r.json()).catch(() => []),
    ])
      .then(([tData, pgData]) => {
        if (Array.isArray(tData)) setTemplates(tData);
        if (Array.isArray(pgData)) setProviderGroups(pgData);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [portalId, configId, refreshKey]);

  async function handleDelete(templateId: string) {
    if (!confirm("Delete this template?")) return;
    setDeleting(templateId);
    try {
      await fetch(`/api/portals/${portalId}/templates/${templateId}`, { method: "DELETE" });
      setTemplates((prev) => prev.filter((t) => t.id !== templateId));
    } finally {
      setDeleting(null);
    }
  }

  async function handleCreate(ct: DetectedClaimType, providerGroupId?: string | null) {
    setCreating(ct.label);
    try {
      const res = await fetch(`/api/portals/${portalId}/templates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: ct.label, comparisonConfigId: configId, providerGroupId: providerGroupId ?? null, groupingKey: ct.groupingKey, fields: [] }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message ?? "Failed to create");
      }
      const created = await res.json();
      router.push(`/portals/${portalId}/templates/${created.id}`);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to create");
      setCreating(null);
    }
  }

  async function handleCreateManual() {
    const name = addName.trim();
    if (!name) return;
    setCreating(name);
    try {
      const groupingKey: Record<string, string> = {};
      if (groupingFields.length > 1) {
        const parts = name.split("/").map((p) => p.trim()).filter(Boolean);
        for (let i = 0; i < groupingFields.length; i++) {
          groupingKey[groupingFields[i]] = parts[i] ?? parts[parts.length - 1] ?? name;
        }
      } else if (groupingFields.length === 1) {
        groupingKey[groupingFields[0]] = name;
      }
      const res = await fetch(`/api/portals/${portalId}/templates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, comparisonConfigId: configId, providerGroupId: addProviderGroupId, groupingKey, fields: [] }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message ?? "Failed to create");
      }
      const created = await res.json();
      router.push(`/portals/${portalId}/templates/${created.id}`);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to create");
      setCreating(null);
    }
  }

  async function handleCopyFrom(ct: DetectedClaimType, sourceTemplate: ComparisonTemplateSummary, existingTemplateId?: string) {
    setCreating(ct.label);
    try {
      if (existingTemplateId) {
        const res = await fetch(`/api/portals/${portalId}/templates/${existingTemplateId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fields: sourceTemplate.fields,
            requiredDocuments: sourceTemplate.requiredDocuments ?? [],
            businessRules: sourceTemplate.businessRules ?? [],
          }),
        });
        if (!res.ok) throw new Error("Failed to update");
        const updated = await res.json();
        setTemplates((prev) => prev.map((t) => (t.id === existingTemplateId ? updated : t)));
      } else {
        const res = await fetch(`/api/portals/${portalId}/templates`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: ct.label,
            comparisonConfigId: configId,
            groupingKey: ct.groupingKey,
            fields: sourceTemplate.fields,
            requiredDocuments: sourceTemplate.requiredDocuments ?? [],
            businessRules: sourceTemplate.businessRules ?? [],
          }),
        });
        if (!res.ok) throw new Error("Failed to create");
        const created = await res.json();
        setTemplates((prev) => [...prev, created]);
      }
    } finally {
      setCreating(null);
    }
  }

  const templatesByLabel = useMemo(() => {
    const map = new Map<string, ComparisonTemplateSummary[]>();
    for (const t of templates) {
      const label = groupingFields.length > 0
        ? groupingFields.map((f) => t.groupingKey[f] ?? "").filter(Boolean).join(" / ") || null
        : null;
      if (label) {
        const arr = map.get(label) ?? [];
        arr.push(t);
        map.set(label, arr);
      }
    }
    return map;
  }, [templates, groupingFields]);

  const hasScrapedData = detectedClaimTypes.length > 0;
  const labeledTemplateIds = new Set(
    Array.from(templatesByLabel.values()).flat().map((t) => t.id)
  );
  const orphaned = templates.filter((t) => {
    if (!hasScrapedData || groupingFields.length === 0) return false;
    return !labeledTemplateIds.has(t.id);
  });
  const preScrapedTemplates = !hasScrapedData ? templates : [];

  if (loading) {
    return (
      <div className="py-4 text-center">
        <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const selectCls = "h-7 rounded-md border border-border bg-background px-2 text-xs text-muted-foreground hover:text-foreground focus:outline-none focus:ring-1 focus:ring-ring";

  function TemplateRow({ t }: { t: ComparisonTemplateSummary }) {
    const fieldCount = t.fields?.length ?? 0;
    const ruleCount = (t.businessRules?.length ?? 0) + (t.requiredDocuments?.length ?? 0);
    return (
      <div className="rounded-lg border border-border p-3 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-status-success" />
            <span className="text-sm font-medium text-foreground truncate">{t.name}</span>
            {t.providerGroupName && (
              <Badge variant="outline" className="text-[10px] shrink-0">
                {t.providerGroupName}
              </Badge>
            )}
            <span className="text-xs text-muted-foreground shrink-0">
              {fieldCount} field{fieldCount !== 1 ? "s" : ""}
              {ruleCount > 0 && `, ${ruleCount} rule${ruleCount !== 1 ? "s" : ""}`}
            </span>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Button
              variant="ghost"
              size="sm"
              asChild
              className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground gap-1"
            >
              <Link href={`/portals/${portalId}/templates/${t.id}`}>
                <ExternalLink className="h-3.5 w-3.5" />
                Edit
              </Link>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleDelete(t.id)}
              disabled={deleting === t.id}
              className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
            >
              {deleting === t.id ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Trash2 className="h-3.5 w-3.5" />
              )}
            </Button>
          </div>
        </div>
        {fieldCount > 0 && (
          <div className="flex flex-wrap gap-1">
            {t.fields.map((f, i) => (
              <span
                key={i}
                className="inline-flex items-center rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground"
              >
                {getFieldDisplayName(f as { portalFieldName?: string; fieldName?: string }, i)}
              </span>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent text-[10px] font-bold text-white">
            2
          </span>
          <div>
            <p className="text-sm font-medium text-foreground">
              Comparison rules
              {templates.length > 0 && (
                <span className="ml-1.5 text-muted-foreground font-normal">
                  ({templates.length} configured)
                </span>
              )}
            </p>
            <p className="text-xs text-muted-foreground">
              Which fields should the AI check against the document — per claim type
            </p>
          </div>
        </div>
        {!showAddForm && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => { setShowAddForm(true); setAddName(""); }}
            className="h-7 text-xs shrink-0"
          >
            <Plus className="mr-1 h-3.5 w-3.5" />
            Add template
          </Button>
        )}
      </div>

      <div className="pl-7 space-y-2">
        {/* Inline add form */}
        {showAddForm && (
          <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-2">
            <p className="text-xs text-muted-foreground">
              {groupingFields.length > 0
                ? <>Enter a name for this template (matching {groupingFields.map((f, i) => <><span key={f} className="font-mono text-foreground">{f}</span>{i < groupingFields.length - 1 ? ", " : ""}</>)})</>
                : "Enter a name for this template"}
            </p>
            <div className="flex items-center gap-2">
              <input
                autoFocus
                type="text"
                value={addName}
                onChange={(e) => setAddName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleCreateManual(); if (e.key === "Escape") setShowAddForm(false); }}
                placeholder={groupingFields.length > 0 ? `e.g. Group Hospital and Surgical` : "Template name"}
                className="flex-1 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              />
              {providerGroups.length > 0 && (
                <select
                  value={addProviderGroupId ?? ""}
                  onChange={(e) => setAddProviderGroupId(e.target.value || null)}
                  className="rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  <option value="">All providers</option>
                  {providerGroups.map((pg) => (
                    <option key={pg.id} value={pg.id}>{pg.name}</option>
                  ))}
                </select>
              )}
              <Button
                size="sm"
                onClick={handleCreateManual}
                disabled={!addName.trim() || !!creating}
                className="h-8 text-xs shrink-0"
              >
                {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Create"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setShowAddForm(false)}
                className="h-8 text-xs shrink-0"
              >
                Cancel
              </Button>
            </div>
          </div>
        )}

        {/* Existing templates (pre-scrape or post-scrape not matched) */}
        {preScrapedTemplates.length > 0 && (
          <div className="space-y-2">
            {preScrapedTemplates.map((t) => <TemplateRow key={t.id} t={t} />)}
          </div>
        )}

        {/* Detected claim types */}
        {detectedClaimTypes.map((ct) => {
          const matchedTemplates = templatesByLabel.get(ct.label) ?? [];
          const isCreating = creating === ct.label;
          return (
            <div key={ct.label} className="rounded-lg border border-border p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  {matchedTemplates.length > 0 ? (
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-status-success" />
                  ) : (
                    <FileSliders className="h-4 w-4 shrink-0 text-muted-foreground" />
                  )}
                  <span className="text-sm font-medium text-foreground truncate">{ct.label}</span>
                  {matchedTemplates.length === 0 && (
                    <Badge variant="outline" className="text-xs shrink-0 text-muted-foreground">
                      not configured
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {templates.length > 0 && matchedTemplates.length === 0 && (
                    <select
                      disabled={isCreating}
                      defaultValue=""
                      onChange={(e) => {
                        const src = templates.find((t) => t.id === e.target.value);
                        if (src) handleCopyFrom(ct, src);
                        e.target.value = "";
                      }}
                      className={selectCls}
                    >
                      <option value="" disabled>Copy from…</option>
                      {templates.map((t) => (
                        <option key={t.id} value={t.id}>{t.name}{t.providerGroupName ? ` (${t.providerGroupName})` : ""}</option>
                      ))}
                    </select>
                  )}
                  {(() => {
                    if (matchedTemplates.length === 0) {
                      return (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleCreate(ct)}
                          disabled={isCreating}
                          className="h-7 text-xs shrink-0"
                        >
                          {isCreating ? (
                            <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Plus className="mr-1 h-3.5 w-3.5" />
                          )}
                          Configure
                        </Button>
                      );
                    }
                    if (providerGroups.length === 0) return null;
                    const usedGroupIds = new Set(matchedTemplates.map((t) => t.providerGroupId ?? ""));
                    const hasAllProviders = usedGroupIds.has("");
                    const availableGroups = providerGroups.filter((pg) => !usedGroupIds.has(pg.id));
                    if (availableGroups.length === 0 && hasAllProviders) return null;
                    return (
                      <select
                        disabled={isCreating}
                        defaultValue=""
                        onChange={(e) => {
                          handleCreate(ct, e.target.value || null);
                          e.target.value = "";
                        }}
                        className={selectCls}
                      >
                        <option value="" disabled>+ Add variant…</option>
                        {!hasAllProviders && <option value="">All providers</option>}
                        {availableGroups.map((pg) => (
                          <option key={pg.id} value={pg.id}>{pg.name}</option>
                        ))}
                      </select>
                    );
                  })()}
                </div>
              </div>

              {matchedTemplates.map((template) => {
                const fc = template.fields?.length ?? 0;
                const rc = (template.businessRules?.length ?? 0) + (template.requiredDocuments?.length ?? 0);
                const copySources = templates.filter((t) => t.id !== template.id && (t.fields?.length ?? 0) > 0);
                return (
                  <div key={template.id} className="ml-6 rounded-md border border-border/60 p-2 space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        {template.providerGroupName ? (
                          <Badge variant="outline" className="text-[10px] shrink-0">
                            {template.providerGroupName}
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="text-[10px] shrink-0">
                            All providers
                          </Badge>
                        )}
                        <span className="text-xs text-muted-foreground shrink-0">
                          {fc} field{fc !== 1 ? "s" : ""}
                          {rc > 0 && `, ${rc} rule${rc !== 1 ? "s" : ""}`}
                        </span>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {copySources.length > 0 && (
                          <select
                            disabled={isCreating}
                            defaultValue=""
                            onChange={(e) => {
                              const src = templates.find((t) => t.id === e.target.value);
                              if (src) handleCopyFrom(ct, src, template.id);
                              e.target.value = "";
                            }}
                            className={selectCls}
                          >
                            <option value="" disabled>Copy from…</option>
                            {copySources.map((t) => (
                              <option key={t.id} value={t.id}>{t.name}{t.providerGroupName ? ` (${t.providerGroupName})` : ""}</option>
                            ))}
                          </select>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          asChild
                          className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground gap-1"
                        >
                          <Link href={`/portals/${portalId}/templates/${template.id}`}>
                            <ExternalLink className="h-3.5 w-3.5" />
                            Edit
                          </Link>
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDelete(template.id)}
                          disabled={deleting === template.id}
                          className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                        >
                          {deleting === template.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Trash2 className="h-3.5 w-3.5" />
                          )}
                        </Button>
                      </div>
                    </div>
                    {fc > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {template.fields.map((f, i) => (
                          <span key={i} className="inline-flex items-center rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                            {getFieldDisplayName(f as { portalFieldName?: string; fieldName?: string }, i)}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}

        {/* Orphaned templates */}
        {orphaned.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground pt-1">
              Previously configured (not seen in recent scrapes):
            </p>
            {orphaned.map((t) => (
              <div key={t.id} className="rounded-lg border border-border border-dashed p-3 opacity-60">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-foreground">{t.name}</span>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      asChild
                      className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground gap-1"
                    >
                      <Link href={`/portals/${portalId}/templates/${t.id}`}>
                        <ExternalLink className="h-3.5 w-3.5" />
                        Edit
                      </Link>
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDelete(t.id)}
                      disabled={deleting === t.id}
                      className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                    >
                      {deleting === t.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="h-3.5 w-3.5" />
                      )}
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
