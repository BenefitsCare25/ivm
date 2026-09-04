"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowLeft, ArrowRight, CheckCircle2, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TemplateFieldMappings } from "./template-field-mappings";
import { TemplateRequiredDocuments } from "./template-required-documents";
import { TemplateBusinessRules } from "./template-business-rules";
import { TemplatePromptPreview } from "./template-prompt-preview";
import { Badge } from "@/components/ui/badge";
import { normalizeForMatch } from "@/lib/provider-matching";
import type {
  TemplateField,
  RequiredDocument,
  BusinessRule,
  ProviderGroupMatchMode,
} from "@/types/portal";

export interface ProviderGroupOption {
  id: string;
  name: string;
  matchMode: ProviderGroupMatchMode;
  providerFieldName: string;
  members: string[];
}

export interface ProviderCoverage {
  sampledClaimCount: number;
  uncoveredProviders: string[];
}

export interface TemplateData {
  id: string;
  portalId: string;
  portalName: string;
  comparisonConfigId?: string | null;
  name: string;
  groupingKey: Record<string, string>;
  fields: TemplateField[];
  requiredDocuments: RequiredDocument[];
  businessRules: BusinessRule[];
  availableFields?: string[];
  providerGroupId?: string | null;
  providerGroupName?: string | null;
  createdAt: string;
  updatedAt: string;
}

export function TemplateDetailView({
  template,
  providerGroups = [],
  providerCoverage,
}: {
  template: TemplateData;
  providerGroups?: ProviderGroupOption[];
  providerCoverage?: ProviderCoverage;
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  async function patchTemplate(payload: Partial<{
    fields: TemplateField[];
    requiredDocuments: RequiredDocument[];
    businessRules: BusinessRule[];
    name: string;
    providerGroupId: string | null;
  }>) {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(`/api/portals/${template.portalId}/templates/${template.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || data.message || "Failed to save");
      }
      router.refresh();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="outline" size="sm" asChild>
          <Link href={template.comparisonConfigId ? `/portals/${template.portalId}/templates?configId=${template.comparisonConfigId}` : `/portals/${template.portalId}`}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Comparison Setup
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-semibold text-foreground">{template.name}</h1>
          <div className="flex items-center gap-2">
            <p className="text-sm text-muted-foreground">
              {Object.entries(template.groupingKey)
                .map(([k, v]) => `${k}: ${v}`)
                .join(", ")}
            </p>
            {providerGroups.length > 0 ? (
              <select
                aria-label="Provider group for this comparison template"
                className="h-6 rounded border border-border bg-card px-2 text-[11px] text-foreground"
                value={template.providerGroupId ?? ""}
                onChange={(e) => patchTemplate({ providerGroupId: e.target.value || null })}
                disabled={saving}
              >
                <option value="">No provider group</option>
                {providerGroups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name} ({g.matchMode})
                  </option>
                ))}
              </select>
            ) : template.providerGroupName ? (
              <Badge variant="outline" className="text-[10px]">
                {template.providerGroupName}
              </Badge>
            ) : null}
          </div>
        </div>
      </div>

      {saveError && (
        <p role="alert" className="text-sm text-status-error">{saveError}</p>
      )}

      <TemplateSetupReadiness
        template={template}
        providerGroups={providerGroups}
        providerCoverage={providerCoverage}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <TemplateFieldMappings
          fields={template.fields}
          saving={saving}
          onSave={(fields) => patchTemplate({ fields })}
        />

        <TemplateRequiredDocuments
          requiredDocuments={template.requiredDocuments}
          saving={saving}
          onSave={(requiredDocuments) => patchTemplate({ requiredDocuments })}
        />

        <TemplateBusinessRules
          businessRules={template.businessRules}
          saving={saving}
          onSave={(businessRules) => patchTemplate({ businessRules })}
          availableFields={template.availableFields}
        />

        <TemplatePromptPreview
          portalId={template.portalId}
          templateId={template.id}
        />
      </div>
    </div>
  );
}

interface SetupIssue {
  id: string;
  title: string;
  detail: string;
  action?: "fields" | "providers";
}

function TemplateSetupReadiness({
  template,
  providerGroups,
  providerCoverage,
}: {
  template: TemplateData;
  providerGroups: ProviderGroupOption[];
  providerCoverage?: ProviderCoverage;
}) {
  const selectedGroup = providerGroups.find((group) => group.id === template.providerGroupId);
  const incompleteFields = template.fields.filter(
    (field) => !field.portalFieldName.trim() || !field.documentFieldName.trim()
  );
  const issues: SetupIssue[] = [];

  if (template.fields.length === 0) {
    issues.push({
      id: "no-fields",
      title: "No comparison fields are configured",
      detail: "Add at least one portal field and its document label. Without mappings, the template cannot produce a controlled comparison.",
      action: "fields",
    });
  } else if (incompleteFields.length > 0) {
    issues.push({
      id: "incomplete-fields",
      title: `${incompleteFields.length} field mapping${incompleteFields.length === 1 ? " is" : "s are"} incomplete`,
      detail: "Every row needs both a portal field and a primary document label before it can be used reliably.",
      action: "fields",
    });
  }

  if (template.providerGroupId && !selectedGroup) {
    issues.push({
      id: "missing-provider-group",
      title: "The assigned provider group no longer exists",
      detail: "Choose an available provider group or switch this template to all providers.",
      action: "providers",
    });
  }

  if (selectedGroup?.matchMode === "list") {
    const normalizedMembers = selectedGroup.members
      .map(normalizeForMatch)
      .filter(Boolean);
    const uniqueMembers = new Set(normalizedMembers);

    if (normalizedMembers.length === 0) {
      issues.push({
        id: "empty-provider-list",
        title: `${selectedGroup.name} has no provider names`,
        detail: "A list-based group with no members never matches a claim. Add the provider names shown by the portal.",
        action: "providers",
      });
    } else if (uniqueMembers.size !== normalizedMembers.length) {
      issues.push({
        id: "duplicate-provider-members",
        title: `${selectedGroup.name} contains duplicate provider names`,
        detail: "Remove duplicates. Capitalization, punctuation, apostrophe style, and “&” versus “and” are already treated as equivalent.",
        action: "providers",
      });
    }

    if (
      template.availableFields?.length &&
      !template.availableFields.includes(selectedGroup.providerFieldName)
    ) {
      issues.push({
        id: "provider-field-not-observed",
        title: `The portal field “${selectedGroup.providerFieldName}” was not discovered for this claim type`,
        detail: "Confirm the group’s Match Field uses the exact portal label that contains the provider name.",
        action: "providers",
      });
    }
  }

  if ((providerCoverage?.uncoveredProviders.length ?? 0) > 0) {
    const names = providerCoverage!.uncoveredProviders.join(", ");
    issues.push({
      id: "uncovered-providers",
      title: `${providerCoverage!.uncoveredProviders.length} observed provider value${providerCoverage!.uncoveredProviders.length === 1 ? " is" : "s are"} not covered`,
      detail: `${names}. Add the provider to a list group, create a matching template variant, or add a “Match all others” variant. Uncovered claims otherwise fall back to an uncontrolled comparison.`,
      action: "providers",
    });
  }

  const ready = issues.length === 0;
  const Icon = ready ? CheckCircle2 : AlertTriangle;

  return (
    <section
      aria-labelledby="template-readiness-title"
      aria-live="polite"
      className={`rounded-xl border px-4 py-3 ${
        ready
          ? "border-status-success/30 bg-status-success/10"
          : "border-status-warning/40 bg-status-warning/10"
      }`}
    >
      <div className="flex items-start gap-3">
        <Icon
          aria-hidden="true"
          className={`mt-0.5 h-5 w-5 shrink-0 ${ready ? "text-status-success" : "text-status-warning"}`}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-col justify-between gap-1 sm:flex-row sm:items-center">
            <h2 id="template-readiness-title" className="text-sm font-semibold text-foreground">
              {ready ? "Template routing is ready" : `${issues.length} setup item${issues.length === 1 ? " needs" : "s need"} attention`}
            </h2>
            <span className="text-xs text-muted-foreground">
              {providerCoverage?.sampledClaimCount
                ? `Checked against ${providerCoverage.sampledClaimCount} recent claim${providerCoverage.sampledClaimCount === 1 ? "" : "s"}`
                : "No matching claim samples available yet"}
            </span>
          </div>

          {ready ? (
            <p className="mt-1 text-xs leading-relaxed text-foreground/80">
              New runs will use {template.fields.length} configured field{template.fields.length === 1 ? "" : "s"}
              {selectedGroup ? ` when ${selectedGroup.name} matches` : " for all providers"}. Provider punctuation,
              apostrophe style, legal suffixes, and “&”/“and” variations are normalized automatically.
            </p>
          ) : (
            <ul className="mt-2 space-y-2">
              {issues.map((issue) => (
                <li key={issue.id} className="flex items-start gap-2 text-xs leading-relaxed text-foreground/85">
                  <Info aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-status-warning" />
                  <span className="min-w-0 flex-1">
                    <strong className="font-medium text-foreground">{issue.title}.</strong>{" "}
                    {issue.detail}
                  </span>
                  {issue.action === "providers" && (
                    <Link
                      href={`/portals/${template.portalId}#provider-groups`}
                      className="inline-flex min-h-6 shrink-0 items-center gap-1 font-medium text-foreground underline underline-offset-2 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      Configure
                      <ArrowRight aria-hidden="true" className="h-3 w-3" />
                    </Link>
                  )}
                  {issue.action === "fields" && (
                    <a
                      href="#field-mappings"
                      className="inline-flex min-h-6 shrink-0 items-center gap-1 font-medium text-foreground underline underline-offset-2 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      Configure
                      <ArrowRight aria-hidden="true" className="h-3 w-3" />
                    </a>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
