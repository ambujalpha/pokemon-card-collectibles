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

// Wall-clock budget for the Redis call. With maxRetriesPerRequest=null on
// the client (set so transient ECONNRESETs don't fail-fast), ioredis would
// otherwise queue commands forever while reconnecting — which appears as
// "the purchase is stuck" in the UI. 1.5s is well above a healthy round-
// trip and short enough that humans don't notice on the failure path.
const RATELIMIT_TIMEOUT_MS = 1500;

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label}: timeout after ${ms}ms`)), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

// Throttle the same warning to once per 30s so a flapping connection
// doesn't spray hundreds of identical lines into the log.
const lastWarn = new Map<string, number>();
function warnOnce(label: string, msg: string): void {
  const k = `${label}:${msg}`;
  const now = Date.now();
  const last = lastWarn.get(k) ?? 0;
  if (now - last < 30_000) return;
  lastWarn.set(k, now);
  console.warn(`${label}: bypassing on redis error: ${msg}`);
}

export async function checkLimit(
  key: string,
  opts: CheckLimitOptions,
): Promise<RateLimitResult> {
  const now = opts.now ?? Date.now();
  const windowMs = opts.windowSec * 1000;
  const member = opts.member ?? `${now}:${Math.random().toString(36).slice(2, 10)}`;

  // Fast path: if ioredis already knows the socket is dead, skip the
  // round-trip entirely. Saves the `Stream isn't writeable` log churn.
  if (redis.status !== "ready") {
    warnOnce("ratelimit", `socket status=${redis.status}`);
    return { allowed: true, count: 0, resetAt: now, retryAfterSec: 0 };
  }

  // Fail OPEN on Redis transport errors *and* timeouts. Rate-limiting is
  // defence-in-depth; if Redis is flaky we'd rather admit a few extra
  // calls than 500 / hang the user's purchase. The Upstash REST middleware
  // does the same; together they're the floor.
  let raw: [number, number, number];
  try {
    raw = (await withTimeout(
      redis.eval(SCRIPT, 1, key, String(now), String(windowMs), String(opts.max), member),
      RATELIMIT_TIMEOUT_MS,
      "ratelimit",
    )) as [number, number, number];
  } catch (err) {
    warnOnce("ratelimit", err instanceof Error ? err.message : String(err));
    return { allowed: true, count: 0, resetAt: now, retryAfterSec: 0 };
  }

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
