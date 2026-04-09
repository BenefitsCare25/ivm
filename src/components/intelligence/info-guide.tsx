"use client";

import { useState } from "react";
import { Info, ChevronDown, ChevronUp } from "lucide-react";

interface InfoGuideProps {
  title?: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}

export function InfoGuide({ title = "How this works", children, defaultOpen = true }: InfoGuideProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 px-4 py-3">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 text-left"
        aria-expanded={open}
      >
        <Info className="h-4 w-4 shrink-0 text-blue-500" />
        <span className="flex-1 text-sm font-medium text-foreground">{title}</span>
        {open ? (
          <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        )}
      </button>
      {open && (
        <div className="mt-3 space-y-2 text-sm text-muted-foreground">{children}</div>
      )}
    </div>
  );
}
