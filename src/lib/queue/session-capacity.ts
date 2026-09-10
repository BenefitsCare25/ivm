import { randomUUID } from "node:crypto";
import type IORedis from "ioredis";

const RELEASE_CLAIM_SLOT_SCRIPT = `
  if redis.call("get", KEYS[1]) == ARGV[1] then
    return redis.call("del", KEYS[1])
  end
  return 0
`;

const RENEW_CLAIM_SLOT_SCRIPT = `
  if redis.call("get", KEYS[1]) == ARGV[1] then
    redis.call("pexpire", KEYS[1], ARGV[2])
    return 1
  end
  return 0
`;

const ACQUIRE_ACTIVE_SESSION_SCRIPT = `
  local countKey = KEYS[#KEYS - 1]
  local memberKey = KEYS[#KEYS]
  local slotCount = #KEYS - 2

  for index = 1, slotCount do
    local slotValue = redis.call("get", KEYS[index])
    local sessionPrefix = ARGV[1] .. ":"
    if slotValue == ARGV[1] or
       (slotValue and string.sub(slotValue, 1, string.len(sessionPrefix)) == sessionPrefix) then
      if not redis.call("set", memberKey, ARGV[4], "PX", ARGV[2], "NX") then
        return {0, ""}
      end
      redis.call("incr", countKey)
      redis.call("pexpire", KEYS[index], ARGV[2])
      redis.call("pexpire", countKey, ARGV[2])
      return {index, slotValue}
    end
  end

  for index = 1, slotCount do
    if redis.call("set", KEYS[index], ARGV[3], "PX", ARGV[2], "NX") then
      if not redis.call("set", memberKey, ARGV[4], "PX", ARGV[2], "NX") then
        if redis.call("get", KEYS[index]) == ARGV[3] then
          redis.call("del", KEYS[index])
        end
        return {0, ""}
      end
      redis.call("set", countKey, 1, "PX", ARGV[2])
      return {index, ARGV[3]}
    end
  end

  return {0, ""}
`;

const RELEASE_ACTIVE_SESSION_SCRIPT = `
  if redis.call("get", KEYS[1]) ~= ARGV[1] or
     redis.call("get", KEYS[3]) ~= ARGV[2] then
    return -1
  end
  redis.call("del", KEYS[3])

  local activeClaims = tonumber(redis.call("get", KEYS[2]) or "0")
  if activeClaims <= 1 then
    redis.call("del", KEYS[2])
    if redis.call("get", KEYS[1]) == ARGV[1] then
      redis.call("del", KEYS[1])
    end
    return 0
  end

  activeClaims = redis.call("decr", KEYS[2])
  redis.call("pexpire", KEYS[1], ARGV[3])
  redis.call("pexpire", KEYS[2], ARGV[3])
  return activeClaims
`;

const RENEW_ACTIVE_SESSION_SCRIPT = `
  if redis.call("get", KEYS[1]) ~= ARGV[1] or
     redis.call("get", KEYS[3]) ~= ARGV[2] then
    return 0
  end
  redis.call("pexpire", KEYS[1], ARGV[3])
  redis.call("pexpire", KEYS[3], ARGV[3])
  if redis.call("exists", KEYS[2]) == 1 then
    redis.call("pexpire", KEYS[2], ARGV[3])
  end
  return 1
`;

export interface ClaimSlotLock {
  key: string;
  token: string;
}

export interface ActiveSessionLease {
  slotKey: string;
  slotValue: string;
  countKey: string;
  memberKey: string;
  memberToken: string;
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
  const generation = randomUUID();
  const memberToken = randomUUID();
  const memberKey = `${namespace}:active-session:member:${memberToken}`;
  const requestedSlotValue = `${scrapeSessionId}:${generation}`;
  const result = await connection.eval(
    ACQUIRE_ACTIVE_SESSION_SCRIPT,
    slotKeys.length + 2,
    ...slotKeys,
    countKey,
    memberKey,
    scrapeSessionId,
    ttlMs,
    requestedSlotValue,
    memberToken,
  ) as [number | string, string];
  const slotNumber = Number(result[0]);

  if (slotNumber < 1) return null;

  return {
    slotKey: slotKeys[slotNumber - 1],
    slotValue: result[1],
    countKey,
    memberKey,
    memberToken,
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
    3,
    lease.slotKey,
    lease.countKey,
    lease.memberKey,
    lease.slotValue,
    lease.memberToken,
    ttlMs,
  );
}

export async function renewActiveSessionLease(
  connection: IORedis,
  lease: ActiveSessionLease,
  ttlMs: number,
): Promise<boolean> {
  return Number(await connection.eval(
    RENEW_ACTIVE_SESSION_SCRIPT,
    3,
    lease.slotKey,
    lease.countKey,
    lease.memberKey,
    lease.slotValue,
    lease.memberToken,
    ttlMs,
  )) === 1;
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

export async function renewClaimSlot(
  connection: IORedis,
  lock: ClaimSlotLock,
  ttlMs: number,
): Promise<boolean> {
  return Number(await connection.eval(
    RENEW_CLAIM_SLOT_SCRIPT,
    1,
    lock.key,
    lock.token,
    ttlMs,
  )) === 1;
}
