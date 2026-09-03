import { randomUUID } from "node:crypto";
import type IORedis from "ioredis";

const RELEASE_CLAIM_SLOT_SCRIPT = `
  if redis.call("get", KEYS[1]) == ARGV[1] then
    return redis.call("del", KEYS[1])
  end
  return 0
`;

const ACQUIRE_ACTIVE_SESSION_SCRIPT = `
  local countKey = KEYS[#KEYS]

  for index = 1, #KEYS - 1 do
    if redis.call("get", KEYS[index]) == ARGV[1] then
      redis.call("incr", countKey)
      redis.call("pexpire", KEYS[index], ARGV[2])
      redis.call("pexpire", countKey, ARGV[2])
      return index
    end
  end

  for index = 1, #KEYS - 1 do
    if redis.call("set", KEYS[index], ARGV[1], "PX", ARGV[2], "NX") then
      redis.call("set", countKey, 1, "PX", ARGV[2])
      return index
    end
  end

  return 0
`;

const RELEASE_ACTIVE_SESSION_SCRIPT = `
  if redis.call("get", KEYS[1]) ~= ARGV[1] then
    return 0
  end

  local activeClaims = tonumber(redis.call("get", KEYS[2]) or "0")
  if activeClaims <= 1 then
    redis.call("del", KEYS[2])
    if redis.call("get", KEYS[1]) == ARGV[1] then
      redis.call("del", KEYS[1])
    end
    return 0
  end

  activeClaims = redis.call("decr", KEYS[2])
  redis.call("pexpire", KEYS[1], ARGV[2])
  redis.call("pexpire", KEYS[2], ARGV[2])
  return activeClaims
`;

export interface ClaimSlotLock {
  key: string;
  token: string;
}

export interface ActiveSessionLease {
  slotKey: string;
  countKey: string;
  scrapeSessionId: string;
}

interface CapacityOptions {
  /** Allows isolated integration testing without touching live worker keys. */
  namespace?: string;
}

export async function acquireActiveSessionLease(
  connection: IORedis,
  scrapeSessionId: string,
  maxActiveSessions: number,
  ttlMs: number,
  options: CapacityOptions = {},
): Promise<ActiveSessionLease | null> {
  const namespace = options.namespace ?? "item-detail";
  const slotKeys = Array.from(
    { length: maxActiveSessions },
    (_, index) => `${namespace}:active-session:slot:${index}`,
  );
  const countKey = `${namespace}:active-session:count:${scrapeSessionId}`;
  const slotNumber = Number(await connection.eval(
    ACQUIRE_ACTIVE_SESSION_SCRIPT,
    slotKeys.length + 1,
    ...slotKeys,
    countKey,
    scrapeSessionId,
    ttlMs,
  ));

  if (slotNumber < 1) return null;

  return {
    slotKey: slotKeys[slotNumber - 1],
    countKey,
    scrapeSessionId,
  };
}

export async function releaseActiveSessionLease(
  connection: IORedis,
  lease: ActiveSessionLease,
  ttlMs: number,
): Promise<void> {
  await connection.eval(
    RELEASE_ACTIVE_SESSION_SCRIPT,
    2,
    lease.slotKey,
    lease.countKey,
    lease.scrapeSessionId,
    ttlMs,
  );
}

export async function acquireClaimSlot(
  connection: IORedis,
  scrapeSessionId: string,
  claimConcurrency: number,
  ttlMs: number,
  options: CapacityOptions = {},
): Promise<ClaimSlotLock | null> {
  const namespace = options.namespace ?? "item-detail";
  const token = randomUUID();

  for (let slot = 0; slot < claimConcurrency; slot += 1) {
    // Slot zero retains the original key so old and new workers share the same
    // capacity during rolling deployments. Additional slots raise the session
    // limit without allowing the old single-lock worker to become a fourth job.
    const slotSuffix = slot === 0 ? "" : `:slot:${slot}`;
    const key = `${namespace}:session:${scrapeSessionId}${slotSuffix}`;
    const acquired = await connection.set(key, token, "PX", ttlMs, "NX");

    if (acquired === "OK") return { key, token };
  }

  return null;
}

export async function releaseClaimSlot(
  connection: IORedis,
  lock: ClaimSlotLock,
): Promise<void> {
  await connection.eval(RELEASE_CLAIM_SLOT_SCRIPT, 1, lock.key, lock.token);
}
