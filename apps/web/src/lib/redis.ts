import Redis from "ioredis";

const globalForRedis = globalThis as unknown as { redis?: Redis };

function createRedis(): Redis {
  const url = process.env.REDIS_URL;
  if (!url) {
    throw new Error("REDIS_URL is not set");
  }
  const client = new Redis(url, {
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
  });
  // Without an 'error' listener, ioredis emits failed retries as
  // "Unhandled error event" log storms. Redis is display-only in this app
  // (cache); individual-call failures are handled at the call site, so we
  // just surface them as warnings here.
  client.on("error", (err) => {
    console.warn("redis error:", err instanceof Error ? err.message : err);
  });
  return client;
}

export const redis = globalForRedis.redis ?? createRedis();

if (process.env.NODE_ENV !== "production") {
  globalForRedis.redis = redis;
}
