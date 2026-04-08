"use client";

import { Globe, FileText, FileType } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TargetType } from "@/types/target";

interface TargetTypeSelectorProps {
  onSelect: (type: TargetType) => void;
}

const TARGET_OPTIONS: {
  type: TargetType;
  icon: typeof Globe;
  title: string;
  description: string;
}[] = [
  {
    type: "WEBPAGE",
    icon: Globe,
    title: "Webpage",
    description: "Enter a URL to detect form fields",
  },
  {
    type: "PDF",
    icon: FileText,
    title: "PDF Form",
    description: "Upload an interactive PDF with form fields",
  },
  {
    type: "DOCX",
    icon: FileType,
    title: "DOCX Template",
    description: "Upload a Word document with {{placeholders}}",
  },
];

export function TargetTypeSelector({ onSelect }: TargetTypeSelectorProps) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Choose the type of target you want to fill with the extracted data.
      </p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {TARGET_OPTIONS.map(({ type, icon: Icon, title, description }) => (
          <button
            key={type}
            onClick={() => onSelect(type)}
            className={cn(
              "flex flex-col items-center gap-3 rounded-lg border border-border bg-card p-6",
              "text-center transition-colors",
              "hover:border-foreground/20 hover:bg-muted/50",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            )}
          >
            <Icon className="h-8 w-8 text-muted-foreground" />
            <div>
              <p className="font-medium text-foreground">{title}</p>
              <p className="mt-1 text-xs text-muted-foreground">{description}</p>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
