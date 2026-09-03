"use client";

import { useEffect, useState } from "react";
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
import { Input } from "@/components/ui/input";
import {
  DEFAULT_CLAIM_CONCURRENCY,
  MAX_CLAIM_CONCURRENCY,
  MIN_CLAIM_CONCURRENCY,
} from "@/lib/claim-concurrency";

export interface ScrapeStartOptions {
  submittedFrom?: string;
  submittedTo?: string;
  claimConcurrency: number;
}

interface ScrapeSessionModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onStart: (options: ScrapeStartOptions) => void;
  loading: boolean;
}

export function ScrapeSessionModal({ open, onOpenChange, onStart, loading }: ScrapeSessionModalProps) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [claimConcurrency, setClaimConcurrency] = useState(DEFAULT_CLAIM_CONCURRENCY);

  // Start each session fresh — a prior run's range must not silently carry over.
  useEffect(() => {
    if (open) {
      setFrom("");
      setTo("");
      setClaimConcurrency(DEFAULT_CLAIM_CONCURRENCY);
    }
  }, [open]);

  const rangeInvalid = Boolean(from && to && to < from);

  function handleStart() {
    if (rangeInvalid) return;
    onStart({
      submittedFrom: from || undefined,
      submittedTo: to || undefined,
      claimConcurrency,
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Start Scrape Session</DialogTitle>
          <DialogDescription>
            Start scraping this portal for new items.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div>
            <p className="text-sm font-medium text-foreground">Filter by &ldquo;Submitted On&rdquo;</p>
            <p className="text-xs text-muted-foreground">
              Optional. Only claims submitted within this range are processed. Leave blank to scrape all.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1 text-sm">
              <span className="text-muted-foreground">From</span>
              <Input
                type="date"
                value={from}
                max={to || undefined}
                onChange={(e) => setFrom(e.target.value)}
                disabled={loading}
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-muted-foreground">To (optional)</span>
              <Input
                type="date"
                value={to}
                min={from || undefined}
                onChange={(e) => setTo(e.target.value)}
                disabled={loading}
              />
            </label>
          </div>
          {rangeInvalid && (
            <p className="text-xs text-red-500">&ldquo;To&rdquo; date must be on or after &ldquo;From&rdquo; date.</p>
          )}
          <div className="border-t border-border pt-3">
            <label htmlFor="claim-concurrency" className="text-sm font-medium text-foreground">
              Claims processed at once
            </label>
            <p id="claim-concurrency-help" className="mt-0.5 text-xs text-muted-foreground">
              Higher concurrency finishes sooner but uses more browser and AI capacity.
            </p>
            <select
              id="claim-concurrency"
              aria-describedby="claim-concurrency-help"
              value={claimConcurrency}
              onChange={(event) => setClaimConcurrency(Number(event.target.value))}
              disabled={loading}
              className="mt-2 h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground shadow-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {Array.from(
                { length: MAX_CLAIM_CONCURRENCY - MIN_CLAIM_CONCURRENCY + 1 },
                (_, index) => index + MIN_CLAIM_CONCURRENCY,
              ).map((value) => (
                <option key={value} value={value}>
                  {value} {value === 1 ? "claim — lowest resource use" : value === MAX_CLAIM_CONCURRENCY ? "claims — fastest" : "claims"}
                </option>
              ))}
            </select>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancel
          </Button>
          <Button onClick={handleStart} disabled={loading || rangeInvalid}>
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
