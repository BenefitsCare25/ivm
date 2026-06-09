"use client";

import { useState } from "react";
import Link from "next/link";
import { Loader2, Save } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { RequiredDocumentsEditor } from "./required-documents-editor";
import type { RequiredDocument } from "@/types/portal";

interface Props {
  requiredDocuments: RequiredDocument[];
  saving: boolean;
  onSave: (requiredDocuments: RequiredDocument[]) => void;
}

export function TemplateRequiredDocuments({ requiredDocuments: initial, saving, onSave }: Props) {
  const [docs, setDocs] = useState<RequiredDocument[]>(initial);

  function handleSave() {
    onSave(docs.filter((d) => d.documentTypeName.trim()));
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Required Documents</CardTitle>
          <Button size="sm" onClick={handleSave} disabled={saving} className="h-7 text-xs px-2">
            {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3 mr-1" />}
            Save
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Documents the AI must find among uploaded files. Pick a name from your{" "}
          <Link href="/settings" className="underline hover:text-foreground">
            Document Type Library
          </Link>{" "}
          so aliases are matched. Missing docs are flagged as REQUIRED_DOCUMENT failures.
        </p>
      </CardHeader>
      <CardContent>
        <RequiredDocumentsEditor value={docs} onChange={setDocs} />
      </CardContent>
    </Card>
  );
}
