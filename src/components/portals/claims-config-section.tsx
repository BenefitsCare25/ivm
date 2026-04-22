"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, FileSliders, Plus } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

function ClaimsConfigCard({
  portalId,
  config,
}: {
  portalId: string;
  config: { id: string; name: string; groupingFields: string[]; templateCount: number };
}) {
  const claimField = config.groupingFields[0] ?? null;
  return (
    <Card>
      <CardContent className="flex items-center justify-between gap-4 py-4">
        <div className="flex items-center gap-3">
          <FileSliders className="h-5 w-5 shrink-0 text-muted-foreground" />
          <div>
            <p className="text-sm font-medium text-foreground">{config.name}</p>
            <p className="text-xs text-muted-foreground">
              {claimField
                ? <>Grouped by <span className="font-mono text-foreground">{claimField}</span> · {config.templateCount} template{config.templateCount !== 1 ? "s" : ""} configured</>
                : "Configure AI comparison rules per claim type"}
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" asChild className="shrink-0">
          <Link href={`/portals/${portalId}/templates?configId=${config.id}`}>Configure</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

export function ClaimsConfigSection({
  portalId,
  configs,
}: {
  portalId: string;
  configs: Array<{ id: string; name: string; groupingFields: string[]; templateCount: number }>;
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [saving, setSaving] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  async function handleAdd() {
    const name = newName.trim();
    if (!name) return;
    setSaving(true);
    setAddError(null);
    try {
      const res = await fetch(`/api/portals/${portalId}/configs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Failed to create");
      }
      setAdding(false);
      setNewName("");
      router.refresh();
    } catch (err) {
      setAddError(err instanceof Error ? err.message : "Failed to create");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      {configs.map((config) => (
        <ClaimsConfigCard key={config.id} portalId={portalId} config={config} />
      ))}

      {adding ? (
        <Card>
          <CardContent className="py-4 space-y-3">
            <p className="text-sm font-medium text-foreground">New Claims Configuration</p>
            <div className="flex items-center gap-2">
              <Input
                autoFocus
                placeholder="e.g. Outpatient Claims"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleAdd();
                  if (e.key === "Escape") { setAdding(false); setNewName(""); }
                }}
                className="h-8 text-sm flex-1"
              />
              <Button size="sm" onClick={handleAdd} disabled={!newName.trim() || saving} className="h-8">
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Create"}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => { setAdding(false); setNewName(""); setAddError(null); }} className="h-8">
                Cancel
              </Button>
            </div>
            {addError && <p className="text-xs text-status-error">{addError}</p>}
          </CardContent>
        </Card>
      ) : (
        <Button
          variant="outline"
          size="sm"
          onClick={() => setAdding(true)}
          className="w-full border-dashed text-muted-foreground hover:text-foreground"
        >
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          Add Claims Configuration
        </Button>
      )}
    </div>
  );
}
