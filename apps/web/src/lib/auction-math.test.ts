import { describe, expect, it } from "vitest";

import {
  applyAntiSnipe,
  ANTI_SNIPE_MAX_EXTENSIONS,
  computeAuctionFee,
  minNextBid,
  resolveDuration,
} from "./auction-math";

describe("minNextBid", () => {
  it("applies 5% when that exceeds the $0.10 floor", () => {
    // 5% of 100 = 5.00 → floor not triggered → next = 105.0000
    expect(minNextBid("100.00")).toBe("105.0000");
  });

  it("applies $0.10 floor when 5% would be smaller", () => {
    // 5% of 1.00 = 0.05, below 0.10 floor → step = 0.10 → 1.10
    expect(minNextBid("1.00")).toBe("1.1000");
  });

  it("ceils percentage to the cent (seller-unfriendly is fine — buyer-hostile actually)", () => {
    // 5% of 1.99 = 0.0995 → ceil-to-cent = 0.10 (equals floor) → 2.09
    expect(minNextBid("1.99")).toBe("2.0900");
  });

  it("floor kicks in exactly at $0.01 current", () => {
    expect(minNextBid("0.01")).toBe("0.1100");
  });
});

describe("applyAntiSnipe", () => {
  const baseNow = new Date("2026-05-01T12:00:00Z");

  it("does nothing if bid is outside the 30s window", () => {
    const closesAt = new Date(baseNow.getTime() + 60 * 1000);
    const out = applyAntiSnipe(baseNow, closesAt, 0);
    expect(out.closesAt).toEqual(closesAt);
    expect(out.extensions).toBe(0);
  });

  it("extends by 30s when bid is inside the window", () => {
    const closesAt = new Date(baseNow.getTime() + 10 * 1000);
    const out = applyAntiSnipe(baseNow, closesAt, 3);
    expect(out.extensions).toBe(4);
    expect(out.closesAt.getTime()).toBe(closesAt.getTime() + 30 * 1000);
  });

  it("stops extending once cap is reached", () => {
    const closesAt = new Date(baseNow.getTime() + 5 * 1000);
    const out = applyAntiSnipe(baseNow, closesAt, ANTI_SNIPE_MAX_EXTENSIONS);
    expect(out.extensions).toBe(ANTI_SNIPE_MAX_EXTENSIONS);
    expect(out.closesAt).toEqual(closesAt);
  });

  it("handles bid exactly at the window edge (30s remaining)", () => {
    const closesAt = new Date(baseNow.getTime() + 30 * 1000);
    const out = applyAntiSnipe(baseNow, closesAt, 0);
    expect(out.extensions).toBe(1);
  });
});

describe("computeAuctionFee", () => {
  it("10% of 100 = 10 fee / 90 net", () => {
    expect(computeAuctionFee("100.00")).toEqual({ fee: "10.0000", sellerNet: "90.0000" });
  });
  it("ceils rounding upward, seller eats it", () => {
    // 10% of 1.01 = 0.101 → ceil-to-cent = 0.11 → net 0.90
    expect(computeAuctionFee("1.01")).toEqual({ fee: "0.1100", sellerNet: "0.9000" });
  });
});

describe("resolveDuration", () => {
  it("accepts the three locked presets", () => {
    expect(resolveDuration("1h")).toBe(3600);
    expect(resolveDuration("6h")).toBe(21600);
    expect(resolveDuration("24h")).toBe(86400);
  });
  it("rejects anything else", () => {
    expect(resolveDuration("7d")).toBeNull();
    expect(resolveDuration(3600)).toBeNull();
    expect(resolveDuration(undefined)).toBeNull();
  });
});
