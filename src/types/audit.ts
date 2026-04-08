export interface AuditEventSummary {
  id: string;
  eventType: string;
  actor: string;
  timestamp: string;
  payload: Record<string, unknown>;
}

export const EVENT_LABELS: Record<string, string> = {
  SESSION_CREATED: "Session created",
  SOURCE_UPLOADED: "Source document uploaded",
  EXTRACTION_STARTED: "AI extraction started",
  EXTRACTION_COMPLETED: "AI extraction completed",
  EXTRACTION_FAILED: "AI extraction failed",
  EXTRACTION_FIELD_EDITED: "Extracted field edited",
  TARGET_SELECTED: "Target selected",
  TARGET_DELETED: "Target removed",
  MAPPING_PROPOSED: "AI mapping proposed",
  MAPPING_REVIEWED: "Mapping reviewed",
  MAPPING_ACCEPTED: "Mapping accepted",
  FILL_EXECUTED: "Fill executed",
  SESSION_COMPLETED: "Session completed",
};

export const EVENT_ICONS: Record<string, string> = {
  SESSION_CREATED: "Plus",
  SOURCE_UPLOADED: "Upload",
  EXTRACTION_STARTED: "Loader",
  EXTRACTION_COMPLETED: "CheckCircle",
  EXTRACTION_FAILED: "XCircle",
  EXTRACTION_FIELD_EDITED: "Pencil",
  TARGET_SELECTED: "Target",
  TARGET_DELETED: "Trash2",
  MAPPING_PROPOSED: "GitBranch",
  MAPPING_REVIEWED: "Eye",
  MAPPING_ACCEPTED: "ThumbsUp",
  FILL_EXECUTED: "Play",
  SESSION_COMPLETED: "CheckCircle2",
};

export function getEventLabel(eventType: string): string {
  return EVENT_LABELS[eventType] ?? eventType;
}

export function getEventIconName(eventType: string): string {
  return EVENT_ICONS[eventType] ?? "Circle";
}

export function formatPayloadSummary(
  eventType: string,
  payload: Record<string, unknown>
): string | null {
  switch (eventType) {
    case "SOURCE_UPLOADED":
      return payload.fileName ? `File: ${payload.fileName}` : null;
    case "EXTRACTION_COMPLETED":
      return payload.fieldCount ? `${payload.fieldCount} fields extracted` : null;
    case "EXTRACTION_FIELD_EDITED":
      return payload.fieldLabel ? `Field: ${payload.fieldLabel}` : null;
    case "TARGET_SELECTED":
      return payload.targetType ? `Type: ${payload.targetType}` : null;
    case "MAPPING_PROPOSED":
      return payload.mappingCount ? `${payload.mappingCount} mappings` : null;
    case "FILL_EXECUTED":
      return payload.total ? `${payload.total} fields filled` : null;
    default:
      return null;
  }
}
