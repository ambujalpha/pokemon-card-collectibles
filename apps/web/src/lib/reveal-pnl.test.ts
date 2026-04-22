import { describe, expect, it } from "vitest";

import { computeRevealPnl } from "./reveal-pnl";

describe("computeRevealPnl", () => {
  it("computes both P&L views with exact decimal math", () => {
    const tierPrice = "20.00";
    const cards = [
      { pricedCaptured: "0.25", basePrice: "0.30" },
      { pricedCaptured: "0.50", basePrice: "0.50" },
      { pricedCaptured: "1.25", basePrice: "1.10" },
      { pricedCaptured: "2.20", basePrice: "2.50" },
      { pricedCaptured: "14.20", basePrice: "16.80" },
    ];
    const p = computeRevealPnl(tierPrice, cards);
    expect(p.spent.toFixed(4)).toBe("20.0000");
    expect(p.atPullValue.toFixed(4)).toBe("18.4000");
    expect(p.currentValue.toFixed(4)).toBe("21.2000");
    expect(p.atPullDelta.toFixed(4)).toBe("-1.6000");
    expect(p.currentDelta.toFixed(4)).toBe("1.2000");
    expect(p.atPullPct.toFixed(2)).toBe("-8.00");
    expect(p.currentPct.toFixed(2)).toBe("6.00");
  });

  it("handles a zero-card pack by returning zero totals (defensive)", () => {
    const p = computeRevealPnl("5.00", []);
    expect(p.atPullValue.toFixed(2)).toBe("0.00");
    expect(p.currentValue.toFixed(2)).toBe("0.00");
    expect(p.atPullDelta.toFixed(2)).toBe("-5.00");
    expect(p.currentDelta.toFixed(2)).toBe("-5.00");
  });

  it("avoids division-by-zero when tierPrice is 0", () => {
    const p = computeRevealPnl("0", [
      { pricedCaptured: "1.00", basePrice: "1.50" },
    ]);
    expect(p.atPullPct.toFixed(2)).toBe("0.00");
    expect(p.currentPct.toFixed(2)).toBe("0.00");
  });

  it("is exact even on pathological decimals that would drift as floats", () => {
    // 0.1 + 0.2 !== 0.3 as float. With decimal.js it must be exact.
    const p = computeRevealPnl("0.30", [
      { pricedCaptured: "0.10", basePrice: "0.10" },
      { pricedCaptured: "0.20", basePrice: "0.20" },
    ]);
    expect(p.atPullDelta.toFixed(4)).toBe("0.0000");
    expect(p.currentDelta.toFixed(4)).toBe("0.0000");
  });
});
