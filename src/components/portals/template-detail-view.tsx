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
import type { TemplateField, RequiredDocument, BusinessRule } from "@/types/portal";

export interface TemplateData {
  id: string;
  portalId: string;
  portalName: string;
  name: string;
  groupingKey: Record<string, string>;
  fields: TemplateField[];
  requiredDocuments: RequiredDocument[];
  businessRules: BusinessRule[];
  createdAt: string;
  updatedAt: string;
}

export function TemplateDetailView({ template }: { template: TemplateData }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  async function patchTemplate(payload: Partial<{
    fields: TemplateField[];
    requiredDocuments: RequiredDocument[];
    businessRules: BusinessRule[];
    name: string;
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
          <Link href={`/portals/${template.portalId}`}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            {template.portalName}
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-semibold text-foreground">{template.name}</h1>
          <p className="text-sm text-muted-foreground">
            {Object.entries(template.groupingKey)
              .map(([k, v]) => `${k}: ${v}`)
              .join(", ")}
          </p>
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
        />

        <TemplatePromptPreview
          portalId={template.portalId}
          templateId={template.id}
        />
      </div>
    </div>
  );
}
