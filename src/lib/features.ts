type FeatureFlag =
  | "BROWSER_WORKSPACE"
  | "PDF_FILL"
  | "DOCX_FILL";

const defaults: Record<FeatureFlag, boolean> = {
  BROWSER_WORKSPACE: false,
  PDF_FILL: false,
  DOCX_FILL: false,
};

export function isFeatureEnabled(flag: FeatureFlag): boolean {
  const envKey = `FEATURE_${flag}`;
  const envVal = process.env[envKey];
  if (envVal !== undefined) {
    return envVal === "true" || envVal === "1";
  }
  return defaults[flag];
}
