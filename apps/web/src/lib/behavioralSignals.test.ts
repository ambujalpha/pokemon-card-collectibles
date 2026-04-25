import { describe, expect, it } from "vitest";

import { hashUserAgent, FLAG_THRESHOLD, SIGNAL_WEIGHTS } from "./behavioralSignals";

describe("behavioralSignals helpers", () => {
  it("hashUserAgent collapses null/undefined to a stable bucket", () => {
    expect(hashUserAgent(null)).toBe("unknown");
    expect(hashUserAgent(undefined)).toBe("unknown");
  });

  it("hashUserAgent returns a 16-char hex string for real UAs", () => {
    const h = hashUserAgent("Mozilla/5.0 ...");
    expect(h).toMatch(/^[0-9a-f]{16}$/);
    expect(hashUserAgent("Mozilla/5.0 ...")).toBe(h);
    expect(hashUserAgent("Mozilla/5.1 ...")).not.toBe(h);
  });

  it("flag threshold requires multi-signal co-occurrence", () => {
    // Plan: a single signal cannot flag (max single-signal weight = 40 < 100).
    expect(Math.max(...Object.values(SIGNAL_WEIGHTS))).toBeLessThan(FLAG_THRESHOLD);
    // Two strongest signals together still must not flag (40 + 30 = 70 < 100).
    expect(SIGNAL_WEIGHTS.multiAccount + SIGNAL_WEIGHTS.fastReveal).toBeLessThan(
      FLAG_THRESHOLD,
    );
    // Three signals can clear the threshold.
    expect(
      SIGNAL_WEIGHTS.multiAccount +
        SIGNAL_WEIGHTS.fastReveal +
        SIGNAL_WEIGHTS.rapidPurchase +
        SIGNAL_WEIGHTS.freshSession,
    ).toBeGreaterThan(FLAG_THRESHOLD);
  });
});
