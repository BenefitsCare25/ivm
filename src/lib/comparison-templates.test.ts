import assert from "node:assert/strict";
import test from "node:test";

import { fuzzyMatchProvider, normalizeForMatch } from "@/lib/provider-matching";

test("matches provider aliases across ampersand, apostrophe, and legal-suffix variants", () => {
  const configuredMembers = [
    normalizeForMatch("KK Women's & Children's Hospital"),
  ];

  assert.equal(
    fuzzyMatchProvider(
      "KK Women's and Children's Hospital Pte Ltd",
      configuredMembers
    ),
    true
  );
  assert.equal(
    fuzzyMatchProvider(
      "KK Women’s and Children’s Hospital Pte. Ltd.",
      configuredMembers
    ),
    true
  );
});

test("does not match empty or merely similar provider names", () => {
  const configuredMembers = [
    normalizeForMatch("KK Women's & Children's Hospital"),
  ];

  assert.equal(fuzzyMatchProvider("", configuredMembers), false);
  assert.equal(fuzzyMatchProvider("KK Women's Clinic", configuredMembers), false);
});
