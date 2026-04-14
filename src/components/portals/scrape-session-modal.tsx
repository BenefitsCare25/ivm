"use client";

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

interface ScrapeSessionModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onStart: () => void;
  loading: boolean;
}

export function ScrapeSessionModal({ open, onOpenChange, onStart, loading }: ScrapeSessionModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Start Scrape Session</DialogTitle>
          <DialogDescription>
            Start scraping this portal for new items.
          </DialogDescription>
        </DialogHeader>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancel
          </Button>
          <Button onClick={onStart} disabled={loading}>
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
