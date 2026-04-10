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
  onStart: (options: { expectedDocumentTypeId?: string }) => void;
  loading: boolean;
}

const selectCls =
  "w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring cursor-pointer";

export function ScrapeSessionModal({ open, onOpenChange, onStart, loading }: ScrapeSessionModalProps) {
  const [docTypes, setDocTypes] = useState<DocOption[]>([]);
  const [selectedTypeId, setSelectedTypeId] = useState("");
  const [fetching, setFetching] = useState(false);

  useEffect(() => {
    if (!open) return;
    setFetching(true);
    setSelectedTypeId("");

    fetch("/api/intelligence/document-types")
      .then((r) => r.ok ? r.json() : [])
      .then((types) => {
        setDocTypes(
          (types as (DocOption & { isActive?: boolean })[]).filter((t) => t.isActive !== false)
        );
      })
      .catch(() => setDocTypes([]))
      .finally(() => setFetching(false));
  }, [open]);

  function handleStart() {
    onStart({ expectedDocumentTypeId: selectedTypeId || undefined });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Start Scrape Session</DialogTitle>
          <DialogDescription>
            {docTypes.length > 0
              ? "Optionally tag this session with an expected document type for validation."
              : "Start scraping this portal for new items."}
          </DialogDescription>
        </DialogHeader>

        {fetching ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : docTypes.length > 0 ? (
          <div className="space-y-1.5">
            <label htmlFor="docType" className="text-sm font-medium text-foreground">
              Expected Document Type
              <span className="ml-1 text-xs font-normal text-muted-foreground">(optional)</span>
            </label>
            <select
              id="docType"
              value={selectedTypeId}
              onChange={(e) => setSelectedTypeId(e.target.value)}
              className={selectCls}
            >
              <option value="">None</option>
              {docTypes.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.name}
                </option>
              ))}
            </select>
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
