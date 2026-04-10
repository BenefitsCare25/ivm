"use client";

import { useState, useEffect } from "react";
import { Play, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface DocOption {
  id: string;
  name: string;
}

interface ScrapeSessionModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onStart: (options: { expectedDocumentTypeId?: string; expectedDocumentSetId?: string }) => void;
  loading: boolean;
}

const selectCls =
  "w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring cursor-pointer";

function DocSelect({
  id,
  label,
  value,
  onChange,
  options,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: DocOption[];
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-sm font-medium text-foreground">
        {label}
        <span className="ml-1 text-xs font-normal text-muted-foreground">(optional)</span>
      </label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className={selectCls}>
        <option value="">None</option>
        {options.map((opt) => (
          <option key={opt.id} value={opt.id}>
            {opt.name}
          </option>
        ))}
      </select>
    </div>
  );
}

export function ScrapeSessionModal({ open, onOpenChange, onStart, loading }: ScrapeSessionModalProps) {
  const [docTypes, setDocTypes] = useState<DocOption[]>([]);
  const [docSets, setDocSets] = useState<DocOption[]>([]);
  const [selectedTypeId, setSelectedTypeId] = useState("");
  const [selectedSetId, setSelectedSetId] = useState("");
  const [fetching, setFetching] = useState(false);

  useEffect(() => {
    if (!open) return;
    setFetching(true);
    setSelectedTypeId("");
    setSelectedSetId("");

    Promise.all([
      fetch("/api/intelligence/document-types").then((r) => r.ok ? r.json() : []),
      fetch("/api/intelligence/document-sets").then((r) => r.ok ? r.json() : []),
    ])
      .then(([types, sets]) => {
        setDocTypes(
          (types as DocOption[]).filter((t: DocOption & { isActive?: boolean }) => t.isActive !== false)
        );
        setDocSets(
          (sets as DocOption[]).filter((s: DocOption & { isActive?: boolean }) => s.isActive !== false)
        );
      })
      .catch(() => {
        setDocTypes([]);
        setDocSets([]);
      })
      .finally(() => setFetching(false));
  }, [open]);

  function handleStart() {
    onStart({
      expectedDocumentTypeId: selectedTypeId || undefined,
      expectedDocumentSetId: selectedSetId || undefined,
    });
  }

  const hasIntelligence = docTypes.length > 0 || docSets.length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Start Scrape Session</DialogTitle>
          <DialogDescription>
            {hasIntelligence
              ? "Optionally select an expected document type or set for validation."
              : "Start scraping this portal for new items."}
          </DialogDescription>
        </DialogHeader>

        {fetching ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : hasIntelligence ? (
          <div className="space-y-4">
            {docTypes.length > 0 && (
              <DocSelect
                id="docType"
                label="Expected Document Type"
                value={selectedTypeId}
                onChange={setSelectedTypeId}
                options={docTypes}
              />
            )}
            {docSets.length > 0 && (
              <DocSelect
                id="docSet"
                label="Expected Document Set"
                value={selectedSetId}
                onChange={setSelectedSetId}
                options={docSets}
              />
            )}
          </div>
        ) : null}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancel
          </Button>
          <Button onClick={handleStart} disabled={loading}>
            {loading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Play className="mr-2 h-4 w-4" />
            )}
            Start Scrape
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
