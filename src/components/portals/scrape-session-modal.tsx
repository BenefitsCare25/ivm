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
  benefitYear?: string;
  submittedFrom?: string;
  submittedTo?: string;
  claimConcurrency: number;
}

interface ScrapeSessionModalProps {
  portalId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onStart: (options: ScrapeStartOptions) => void;
  loading: boolean;
}

export function ScrapeSessionModal({ portalId, open, onOpenChange, onStart, loading }: ScrapeSessionModalProps) {
  const [years, setYears] = useState<string[] | null>(null);
  const [benefitYear, setBenefitYear] = useState("");
  const [yearsError, setYearsError] = useState<string | null>(null);
  const [reloadYears, setReloadYears] = useState(0);
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

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setYears(null);
    setBenefitYear("");
    setYearsError(null);
    async function loadYears() {
      try {
        const response = await fetch(`/api/portals/${portalId}/benefit-years`, {
          signal: controller.signal,
          cache: "no-store",
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "Could not load benefit years. Please try again.");
        if (controller.signal.aborted) return;
        setYears(data.years);
        setBenefitYear(data.selected ?? "");
      } catch (error) {
        if (!controller.signal.aborted) setYearsError(error instanceof Error ? error.message : "Could not load benefit years.");
      }
    }
    void loadYears();
    return () => controller.abort();
  }, [open, portalId, reloadYears]);

  const rangeInvalid = Boolean(from && to && to < from);
  const yearsReady = years !== null && !yearsError && (years.length === 0 || years.includes(benefitYear));

  function handleStart() {
    if (rangeInvalid || !yearsReady) return;
    onStart({
      benefitYear: benefitYear || undefined,
      submittedFrom: from || undefined,
      submittedTo: to || undefined,
      claimConcurrency,
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Start Scrape Session</DialogTitle>
          <DialogDescription>
            Start scraping this portal for new items.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="space-y-2">
            <label htmlFor="scrape-benefit-year" className="text-sm font-medium text-foreground">Benefit year</label>
            {yearsError ? (
              <div role="alert" className="space-y-2">
                <p className="text-sm text-destructive">{yearsError}</p>
                <Button variant="outline" size="sm" onClick={() => setReloadYears(value => value + 1)}>Retry loading years</Button>
              </div>
            ) : years === null ? (
              <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> Loading benefit years from portal…
              </p>
            ) : years.length > 0 ? (
              <>
                <select
                  id="scrape-benefit-year"
                  aria-describedby="scrape-benefit-year-help"
                  value={benefitYear}
                  onChange={event => setBenefitYear(event.target.value)}
                  disabled={loading}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground shadow-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50"
                >
                  <option value="" disabled>Select a benefit year</option>
                  {years.map(year => <option key={year} value={year}>{year}</option>)}
                </select>
                <p id="scrape-benefit-year-help" className="text-xs text-muted-foreground">
                  Years come directly from the portal. Choose the year whose claims you want to assess.
                </p>
              </>
            ) : (
              <p className="text-xs text-muted-foreground">Benefit-year selection is not available for this portal.</p>
            )}
          </div>
          <details className="border-t border-border pt-3">
            <summary className="cursor-pointer text-sm font-medium text-foreground">Submitted date filter (optional)</summary>
            <div className="mt-3 space-y-3">
              <p className="text-xs text-muted-foreground">
                Only claims submitted within this range are processed. Leave blank to include all submission dates in the selected benefit year.
              </p>
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
            </div>
          </details>
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
          <Button onClick={handleStart} disabled={loading || rangeInvalid || !yearsReady}>
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
