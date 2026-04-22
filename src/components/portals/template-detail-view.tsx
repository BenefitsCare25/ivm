"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TemplateFieldMappings } from "./template-field-mappings";
import { TemplateRequiredDocuments } from "./template-required-documents";
import { TemplateBusinessRules } from "./template-business-rules";
import { TemplatePromptPreview } from "./template-prompt-preview";
import { Badge } from "@/components/ui/badge";
import type { TemplateField, RequiredDocument, BusinessRule } from "@/types/portal";

export interface ProviderGroupOption {
  id: string;
  name: string;
  matchMode: string;
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

export function TemplateDetailView({ template, providerGroups = [] }: { template: TemplateData; providerGroups?: ProviderGroupOption[] }) {
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
        throw new Error(data.message || "Failed to save");
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
        <p className="text-sm text-status-error">{saveError}</p>
      )}

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
