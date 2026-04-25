import { Redis } from "@upstash/redis";

// Edge-runtime-safe sliding-window-log limiter for Next.js middleware.
//
// Uses Upstash REST (HTTP/fetch under the hood) — works on the Edge
// runtime where ioredis can't load. Same prune→count→add Lua script as
// the Node-side limiter; semantics are identical.
//
// Fails OPEN: if `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`
// aren't set, or the REST call errors, the limiter admits the request
// rather than 500-ing. We treat this as a soft availability signal —
// the per-route Node limiters (purchase, bid) are the hard floor.

const SCRIPT = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local windowMs = tonumber(ARGV[2])
local max = tonumber(ARGV[3])
local member = ARGV[4]

redis.call('ZREMRANGEBYSCORE', key, '-inf', now - windowMs)
local count = redis.call('ZCARD', key)
if count >= max then
  local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  local resetAt = oldest[2] and (tonumber(oldest[2]) + windowMs) or now
  return { 0, count, resetAt }
end

redis.call('ZADD', key, now, member)
redis.call('PEXPIRE', key, windowMs)
return { 1, count + 1, now + windowMs }
`;

let cachedClient: Redis | null | undefined;

function getClient(): Redis | null {
  if (cachedClient !== undefined) return cachedClient;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    cachedClient = null;
    return null;
  }
  cachedClient = new Redis({ url, token });
  return cachedClient;
}

export interface EdgeLimitResult {
  allowed: boolean;
  count: number;
  resetAt: number;
  retryAfterSec: number;
  /** True when the limiter is disabled (env missing or transport error). */
  bypassed: boolean;
}

export interface EdgeLimitOptions {
  windowSec: number;
  max: number;
}

export async function checkLimitEdge(
  key: string,
  opts: EdgeLimitOptions,
): Promise<EdgeLimitResult> {
  const client = getClient();
  if (!client) {
    return bypass();
  }
  const now = Date.now();
  const windowMs = opts.windowSec * 1000;
  const member = `${now}:${Math.random().toString(36).slice(2, 10)}`;

  try {
    const raw = (await client.eval(SCRIPT, [key], [
      String(now),
      String(windowMs),
      String(opts.max),
      member,
    ])) as [number, number, number];

    const allowed = Number(raw[0]) === 1;
    const count = Number(raw[1]);
    const resetAt = Number(raw[2]);
    return {
      allowed,
      count,
      resetAt,
      retryAfterSec: allowed ? 0 : Math.max(1, Math.ceil((resetAt - now) / 1000)),
      bypassed: false,
    };
  } catch (err) {
    // Don't 500 on transport errors. Treat the request as admitted and let
    // the per-route Node limiters do the real work.
    console.warn("ratelimit-edge: bypassing on error:", err instanceof Error ? err.message : err);
    return bypass();
  }
}

function bypass(): EdgeLimitResult {
  return { allowed: true, count: 0, resetAt: Date.now(), retryAfterSec: 0, bypassed: true };
}
