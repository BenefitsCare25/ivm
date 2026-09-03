import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import IORedis from "ioredis";
import {
  acquireActiveSessionLease,
  acquireClaimSlot,
  releaseActiveSessionLease,
  releaseClaimSlot,
  type ActiveSessionLease,
  type ClaimSlotLock,
} from "../src/lib/queue/session-capacity";

const MAX_ACTIVE_SESSIONS = 3;
const TTL_MS = 30_000;

interface CapacityLease {
  session: ActiveSessionLease;
  claim: ClaimSlotLock;
}

const redis = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379", {
  lazyConnect: true,
  maxRetriesPerRequest: 1,
  retryStrategy: () => null,
});
redis.on("error", () => {});
const namespace = `test:item-detail-capacity:${randomUUID()}`;

async function acquire(
  scrapeSessionId: string,
  claimConcurrency: number,
): Promise<CapacityLease | null> {
  const session = await acquireActiveSessionLease(
    redis,
    scrapeSessionId,
    MAX_ACTIVE_SESSIONS,
    TTL_MS,
    { namespace },
  );
  if (!session) return null;

  const claim = await acquireClaimSlot(
    redis,
    scrapeSessionId,
    claimConcurrency,
    TTL_MS,
    { namespace },
  );
  if (!claim) {
    await releaseActiveSessionLease(redis, session, TTL_MS);
    return null;
  }

  return { session, claim };
}

async function release(lease: CapacityLease): Promise<void> {
  await releaseClaimSlot(redis, lease.claim);
  await releaseActiveSessionLease(redis, lease.session, TTL_MS);
}

async function main(): Promise<void> {
  await redis.connect();

  try {
    const sessionA = await Promise.all([
      acquire("session-a", 3),
      acquire("session-a", 3),
      acquire("session-a", 3),
    ]);
    assert(sessionA.every(Boolean), "one session should receive all three claim slots");
    assert.equal(
      await acquire("session-a", 3),
      null,
      "a fourth claim from the same session must be deferred",
    );

    const sessionB = await acquire("session-b", 1);
    const sessionC = await acquire("session-c", 1);
    assert(sessionB && sessionC, "three distinct sessions should be active together");
    assert.equal(
      await acquire("session-d", 1),
      null,
      "a fourth distinct session must be deferred",
    );

    await Promise.all(sessionA.map((lease) => release(lease!)));
    const sessionD = await acquire("session-d", 1);
    assert(sessionD, "a waiting session should start after an active session releases its slot");

    await Promise.all([release(sessionB!), release(sessionC!), release(sessionD)]);
    assert.deepEqual(
      await redis.keys(`${namespace}:*`),
      [],
      "all capacity keys should be released",
    );

    console.log("session capacity integration test passed");
  } finally {
    const keys = redis.status === "ready" ? await redis.keys(`${namespace}:*`) : [];
    if (keys.length > 0) await redis.del(...keys);
    await redis.quit();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
