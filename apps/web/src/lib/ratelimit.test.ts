import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// In-memory mock of just the redis.eval shape we use, executing the same
// sliding-window-log semantics. Lets us validate the *protocol* contract
// without needing a real Redis in unit tests.

interface ZEntry { member: string; score: number }

const store = new Map<string, ZEntry[]>();

function fakeEval(_script: string, _numKeys: number, key: string, nowS: string, winS: string, maxS: string, member: string): [number, number, number] {
  const now = Number(nowS);
  const windowMs = Number(winS);
  const max = Number(maxS);

  const list = store.get(key) ?? [];
  const pruned = list.filter((e) => e.score > now - windowMs);
  if (pruned.length >= max) {
    const oldest = pruned[0]?.score ?? now;
    store.set(key, pruned);
    return [0, pruned.length, oldest + windowMs];
  }
  pruned.push({ member, score: now });
  pruned.sort((a, b) => a.score - b.score);
  store.set(key, pruned);
  return [1, pruned.length, now + windowMs];
}

vi.mock("@/lib/redis", () => ({
  redis: {
    status: "ready",
    eval: (...args: unknown[]) => Promise.resolve(fakeEval(
      args[0] as string,
      args[1] as number,
      args[2] as string,
      args[3] as string,
      args[4] as string,
      args[5] as string,
      args[6] as string,
    )),
  },
}));

import { checkLimit, checkLimits } from "./ratelimit";

beforeEach(() => store.clear());
afterEach(() => store.clear());

describe("checkLimit", () => {
  it("admits up to max within the window", async () => {
    const now = 1_000_000;
    for (let i = 0; i < 5; i++) {
      const r = await checkLimit("k", { windowSec: 60, max: 5, now: now + i });
      expect(r.allowed).toBe(true);
      expect(r.count).toBe(i + 1);
    }
  });

  it("blocks call number max+1 within the window", async () => {
    const now = 1_000_000;
    for (let i = 0; i < 5; i++) {
      await checkLimit("k", { windowSec: 60, max: 5, now: now + i });
    }
    const blocked = await checkLimit("k", { windowSec: 60, max: 5, now: now + 6 });
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSec).toBeGreaterThan(0);
  });

  it("admits again after the window expires", async () => {
    const now = 1_000_000;
    for (let i = 0; i < 5; i++) {
      await checkLimit("k", { windowSec: 60, max: 5, now: now + i });
    }
    const after = await checkLimit("k", { windowSec: 60, max: 5, now: now + 60_001 });
    expect(after.allowed).toBe(true);
  });

  it("isolates by key", async () => {
    const now = 1_000_000;
    for (let i = 0; i < 5; i++) {
      await checkLimit("a", { windowSec: 60, max: 5, now: now + i });
    }
    const b = await checkLimit("b", { windowSec: 60, max: 5, now: now + 6 });
    expect(b.allowed).toBe(true);
  });

  it("under simulated 1000-call burst, exactly max are admitted", async () => {
    const now = 1_000_000;
    let admitted = 0;
    for (let i = 0; i < 1000; i++) {
      const r = await checkLimit("burst", { windowSec: 10, max: 50, now: now + i });
      if (r.allowed) admitted++;
    }
    expect(admitted).toBe(50);
  });
});

describe("checkLimits", () => {
  it("returns failedKey on the first failing spec", async () => {
    // checkLimits uses Date.now() internally, so prefill against current epoch.
    const now = Date.now();
    for (let i = 0; i < 3; i++) {
      await checkLimit("ip:1", { windowSec: 60, max: 3, now: now + i });
    }
    const r = await checkLimits([
      { key: "ip:1", windowSec: 60, max: 3 },
      { key: "user:1", windowSec: 60, max: 100 },
    ]);
    expect(r.allowed).toBe(false);
    expect(r.failedKey).toBe("ip:1");
  });

  it("admits when all specs pass", async () => {
    const r = await checkLimits([
      { key: "ip:2", windowSec: 60, max: 60 },
      { key: "user:2", windowSec: 60, max: 6 },
    ]);
    expect(r.allowed).toBe(true);
  });
});
