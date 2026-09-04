import assert from "node:assert/strict";
import test from "node:test";

import { validateProviderGroupDraft } from "@/lib/provider-group-validation";

test("explains why an empty list provider group cannot be saved", () => {
  const issues = validateProviderGroupDraft({
    name: "Government Hospitals",
    providerFieldName: "Provider",
    matchMode: "list",
    members: [],
  });

  assert.deepEqual(issues.map((issue) => issue.code), ["EMPTY_LIST"]);
  assert.match(issues[0]!.message, /cannot match any claim/i);
});

test("treats punctuation and ampersand variants as duplicate provider members", () => {
  const issues = validateProviderGroupDraft({
    name: "Government Hospitals",
    providerFieldName: "Provider",
    matchMode: "list",
    members: [
      "KK Women's & Children's Hospital",
      "KK Women’s and Children’s Hospital",
    ],
  });

  assert.deepEqual(issues.map((issue) => issue.code), ["DUPLICATE_MEMBER"]);
});

test("allows an others group without explicit members", () => {
  assert.deepEqual(
    validateProviderGroupDraft({
      name: "All other providers",
      providerFieldName: "Provider",
      matchMode: "others",
      members: [],
    }),
    []
  );
});
