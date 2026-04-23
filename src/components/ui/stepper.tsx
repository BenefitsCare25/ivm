"use client";

import { cn } from "@/lib/utils";
import { Check } from "lucide-react";

export interface Step {
  id: string;
  label: string;
  description?: string;
  status: "completed" | "current" | "upcoming";
}

interface StepperProps {
  steps: Step[];
  className?: string;
  onStepClick?: (stepId: string) => void;
}

export function Stepper({ steps, className, onStepClick }: StepperProps) {
  return (
    <nav aria-label="Progress" className={cn("w-full", className)}>
      <ol className="flex items-center gap-2">
        {steps.map((step, index) => (
          <li key={step.id} className="flex items-center gap-2 flex-1">
            <button
              type="button"
              onClick={() => onStepClick?.(step.id)}
              className={cn(
                "flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors w-full",
                step.status === "completed" &&
                  "text-status-success",
                step.status === "current" &&
                  "bg-primary/20 text-primary font-medium backdrop-blur-sm",
                step.status === "upcoming" &&
                  "text-muted-foreground"
              )}
            >
              <span
                className={cn(
                  "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-medium",
                  step.status === "completed" &&
                    "bg-status-success/10 text-status-success",
                  step.status === "current" &&
                    "bg-primary text-primary-foreground",
                  step.status === "upcoming" &&
                    "bg-accent/20 text-muted-foreground"
                )}
              >
                {step.status === "completed" ? (
                  <Check className="h-3.5 w-3.5" />
                ) : (
                  index + 1
                )}
              </span>
              <span className="hidden sm:inline">{step.label}</span>
            </button>
            {index < steps.length - 1 && (
              <div
                className={cn(
                  "h-px flex-1 min-w-4",
                  step.status === "completed"
                    ? "bg-status-success/40"
                    : "bg-border"
                )}
              />
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
