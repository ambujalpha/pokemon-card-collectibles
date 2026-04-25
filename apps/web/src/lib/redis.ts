import Redis from "ioredis";

const globalForRedis = globalThis as unknown as { redis?: Redis };

function createRedis(): Redis {
  const url = process.env.REDIS_URL;
  if (!url) {
    throw new Error("REDIS_URL is not set");
  }
  // Upstash drops idle TCP connections aggressively. Settings tuned to
  // recover transparently rather than fail-fast:
  //   - enableReadyCheck:false — Upstash doesn't expose CLUSTER INFO; the
  //     ready-check ping that ioredis defaults to causes false negatives.
  //   - maxRetriesPerRequest:null — let calls wait through a reconnect
  //     instead of throwing "max retries" mid-purchase.
  //   - reconnectOnError — force a reconnect when the upstream goes
  //     READONLY (Upstash failover) or the socket drops.
  const client = new Redis(url, {
    enableReadyCheck: false,
    // Cap retries-per-request so a dead socket doesn't queue calls forever.
    // Callers wrap their redis ops in fail-open timeouts (see ratelimit.ts,
    // auction-integrity.ts) so a few in-flight retries are fine.
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    connectTimeout: 5_000,
    commandTimeout: 1_000,
    keepAlive: 30_000,
    reconnectOnError(err) {
      const msg = err.message;
      if (msg.includes("READONLY") || msg.includes("ECONNRESET")) return 2;
      return false;
    },
    retryStrategy(times) {
      return Math.min(times * 200, 2000);
    },
  });
  // Without an 'error' listener, ioredis emits failed retries as
  // "Unhandled error event" log storms. Redis is best-effort for
  // rate-limits and price cache here; individual-call failures are
  // handled at the call site, so we just surface them as warnings.
  client.on("error", (err) => {
    console.warn("redis error:", err instanceof Error ? err.message : err);
  });
  return client;
}

export const redis = globalForRedis.redis ?? createRedis();

if (process.env.NODE_ENV !== "production") {
  globalForRedis.redis = redis;
}
