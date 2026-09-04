import { normalizeForMatch } from "@/lib/provider-matching";
import type { ProviderGroupMatchMode } from "@/types/portal";

export type ProviderGroupDraftIssueCode =
  | "MISSING_NAME"
  | "MISSING_FIELD"
  | "EMPTY_LIST"
  | "DUPLICATE_MEMBER";

export interface ProviderGroupDraftIssue {
  code: ProviderGroupDraftIssueCode;
  message: string;
}

export interface ProviderGroupDraft {
  name: string;
  providerFieldName: string;
  matchMode: ProviderGroupMatchMode;
  members: string[];
}

export function cleanProviderGroupMembers(members: string[]): string[] {
  return members.map((member) => member.trim()).filter(Boolean);
}

export function validateProviderGroupDraft(
  draft: ProviderGroupDraft
): ProviderGroupDraftIssue[] {
  const issues: ProviderGroupDraftIssue[] = [];
  const members = cleanProviderGroupMembers(draft.members);

  if (!draft.name.trim()) {
    issues.push({ code: "MISSING_NAME", message: "Enter a name for this provider group." });
  }
  if (!draft.providerFieldName.trim()) {
    issues.push({
      code: "MISSING_FIELD",
      message: "Choose the portal field that contains the provider name.",
    });
  }
  if (draft.matchMode === "list" && members.length === 0) {
    issues.push({
      code: "EMPTY_LIST",
      message: "Add at least one provider. An empty list group cannot match any claim.",
    });
  }

  const normalizedMembers = members.map(normalizeForMatch);
  if (new Set(normalizedMembers).size !== normalizedMembers.length) {
    issues.push({
      code: "DUPLICATE_MEMBER",
      message: "Remove duplicate provider names. Punctuation, apostrophes, and “&”/“and” variants already match automatically.",
    });
  }

  return issues;
}
