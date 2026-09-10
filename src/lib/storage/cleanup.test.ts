import assert from "node:assert/strict";
import test from "node:test";
import { getTerminalRetentionAgeFilter } from "./cleanup";

test("terminal retention uses completion time with a legacy creation fallback", () => {
  const cutoff = new Date("2026-09-08T00:00:00.000Z");

  assert.deepEqual(getTerminalRetentionAgeFilter(cutoff), {
    OR: [
      { completedAt: { lt: cutoff } },
      { completedAt: null, createdAt: { lt: cutoff } },
    ],
  });
});
