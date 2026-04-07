export const SESSION_STEPS = [
  "SOURCE",
  "EXTRACT",
  "TARGET",
  "MAP",
  "FILL",
  "REVIEW",
] as const;

export type SessionStep = (typeof SESSION_STEPS)[number];

export const STEP_LABELS: Record<SessionStep, string> = {
  SOURCE: "Source",
  EXTRACT: "Extract",
  TARGET: "Target",
  MAP: "Map",
  FILL: "Fill",
  REVIEW: "Review",
};

export const STEP_DESCRIPTIONS: Record<SessionStep, string> = {
  SOURCE: "Upload your source document",
  EXTRACT: "Review extracted fields",
  TARGET: "Select your target form",
  MAP: "Review field mappings",
  FILL: "Execute form fill",
  REVIEW: "Review and approve",
};

export interface SessionSummary {
  id: string;
  title: string;
  description: string | null;
  status: string;
  currentStep: SessionStep;
  createdAt: string;
  updatedAt: string;
}
