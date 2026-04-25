import { redis } from "@/lib/redis";

// Sliding-window-log rate limiter.
//
// Each call is timestamped (ms-since-epoch) into a Redis ZSET. Expired
// entries (older than the window) are pruned by score, then the remaining
// cardinality is checked against `max`. The full sequence runs inside a
// Lua script so the prune→count→add path is atomic — no race between
// concurrent callers, no WATCH/MULTI retry storm.
//
// Sliding-window-log over fixed-window: the latter has the classic
// 2× burst at the window edge. Sliding-window-log is exact at the cost
// of O(n) memory per key, where n = max permitted in window.

const SCRIPT = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local windowMs = tonumber(ARGV[2])
local max = tonumber(ARGV[3])
local member = ARGV[4]

redis.call('ZREMRANGEBYSCORE', key, '-inf', now - windowMs)
local count = redis.call('ZCARD', key)
if count >= max then
  -- Return the oldest still-valid score so callers can compute retry-after.
  local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  local resetAt = oldest[2] and (tonumber(oldest[2]) + windowMs) or now
  return { 0, count, resetAt }
end

redis.call('ZADD', key, now, member)
redis.call('PEXPIRE', key, windowMs)
return { 1, count + 1, now + windowMs }
`;

export interface RateLimitResult {
  /** True if the request should be admitted. */
  allowed: boolean;
  /** Number of calls in the window after this one (or before, if blocked). */
  count: number;
  /** Wall-clock ms since epoch when the limit will partially refill. */
  resetAt: number;
  /** Suggested Retry-After in seconds. 0 when allowed. */
  retryAfterSec: number;
}

export interface CheckLimitOptions {
  windowSec: number;
  max: number;
  /** Override "now" for tests. Defaults to Date.now(). */
  now?: number;
  /** Unique member id; defaults to a per-call random string. */
  member?: string;
}

export async function checkLimit(
  key: string,
  opts: CheckLimitOptions,
): Promise<RateLimitResult> {
  const now = opts.now ?? Date.now();
  const windowMs = opts.windowSec * 1000;
  const member = opts.member ?? `${now}:${Math.random().toString(36).slice(2, 10)}`;

  const raw = (await redis.eval(
    SCRIPT,
    1,
    key,
    String(now),
    String(windowMs),
    String(opts.max),
    member,
  )) as [number, number, number];

  const allowed = raw[0] === 1;
  const count = Number(raw[1]);
  const resetAt = Number(raw[2]);
  const retryAfterSec = allowed ? 0 : Math.max(1, Math.ceil((resetAt - now) / 1000));

  return { allowed, count, resetAt, retryAfterSec };
}

export interface LimitSpec {
  key: string;
  windowSec: number;
  max: number;
}

// Helper for routes that need to enforce several limits at once (e.g. per-IP
// + per-user). Stops on the first failure and returns it.
export async function checkLimits(specs: readonly LimitSpec[]): Promise<RateLimitResult & { failedKey?: string }> {
  for (const s of specs) {
    const r = await checkLimit(s.key, { windowSec: s.windowSec, max: s.max });
    if (!r.allowed) return { ...r, failedKey: s.key };
  }
  return { allowed: true, count: 0, resetAt: Date.now(), retryAfterSec: 0 };
}
