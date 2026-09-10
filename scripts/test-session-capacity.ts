import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import IORedis from "ioredis";
import {
  acquireActiveSessionLease,
  acquireClaimSlot,
  releaseActiveSessionLease,
  releaseClaimSlot,
  renewActiveSessionLease,
  renewClaimSlot,
  type ActiveSessionLease,
  type ClaimSlotLock,
} from "../src/lib/queue/session-capacity";

const MAX_ACTIVE_SESSIONS = 3;
const TTL_MS = 30_000;
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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
    const renewalTtl = TTL_MS * 2;
    assert.equal(await renewClaimSlot(redis, sessionB.claim, renewalTtl), true);
    assert.equal(await renewActiveSessionLease(redis, sessionB.session, renewalTtl), true);
    assert((await redis.pttl(sessionB.claim.key)) > TTL_MS, "claim renewal should extend its TTL");
    assert((await redis.pttl(sessionB.session.slotKey)) > TTL_MS, "session renewal should extend its TTL");
    assert((await redis.pttl(sessionB.session.memberKey)) > TTL_MS, "session-member renewal should extend its TTL");
    assert.equal(
      await acquire("session-d", 1),
      null,
      "a fourth distinct session must be deferred",
    );

    await Promise.all(sessionA.map((lease) => release(lease!)));
    const sessionD = await acquire("session-d", 1);
    assert(sessionD, "a waiting session should start after an active session releases its slot");

    await Promise.all([release(sessionB!), release(sessionC!), release(sessionD)]);

    const staleNamespace = `${namespace}:stale-release`;
    const shortTtl = 80;
    const staleLease = await acquireActiveSessionLease(
      redis,
      "same-session",
      1,
      shortTtl,
      { namespace: staleNamespace },
    );
    assert(staleLease);
    await delay(shortTtl + 40);
    const replacementLease = await acquireActiveSessionLease(
      redis,
      "same-session",
      1,
      TTL_MS,
      { namespace: staleNamespace },
    );
    assert(replacementLease);

    // A timed-out owner from an earlier slot generation must not decrement or
    // release the replacement generation, even when the session ID is equal.
    await releaseActiveSessionLease(redis, staleLease, TTL_MS);
    assert.equal(await redis.get(replacementLease.countKey), "1");
    assert.equal(
      await redis.get(replacementLease.slotKey),
      replacementLease.slotValue,
    );
    await releaseActiveSessionLease(redis, replacementLease, TTL_MS);

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
