import { describe, expect, it } from "vitest";

import { snapshotToCsv, windowSince, type EconomicsSnapshot } from "./economics";

describe("windowSince", () => {
  const noon = new Date("2026-04-22T12:34:56Z");

  it("today resets to UTC midnight", () => {
    const s = windowSince("today", noon);
    expect(s?.toISOString()).toBe("2026-04-22T00:00:00.000Z");
  });
  it("7d subtracts 7×24h", () => {
    const s = windowSince("7d", noon);
    expect(s?.toISOString()).toBe("2026-04-15T12:34:56.000Z");
  });
  it("30d subtracts 30×24h", () => {
    const s = windowSince("30d", noon);
    expect(s?.toISOString()).toBe("2026-03-23T12:34:56.000Z");
  });
  it("all returns null", () => {
    expect(windowSince("all", noon)).toBeNull();
  });
});

describe("snapshotToCsv", () => {
  const sample: EconomicsSnapshot = {
    window: "today",
    since: "2026-04-22T00:00:00.000Z",
    generatedAt: "2026-04-22T12:00:00.000Z",
    packs: {
      totalRevenue: "200.0000",
      totalEvRealised: "150.0000",
      totalMarginAbs: "50.0000",
      totalMarginPct: "25.00",
      perTier: [
        { tier: "STARTER", count: 10, revenue: "50.0000", evRealised: "32.0000", evTarget: "32.3450", marginAbs: "18.0000", marginPct: "36.00", evRealisedVsTargetPct: "98.92" },
        { tier: "PREMIUM", count: 5, revenue: "100.0000", evRealised: "75.0000", evTarget: "75.1135", marginAbs: "25.0000", marginPct: "25.00", evRealisedVsTargetPct: "99.85" },
        { tier: "ULTRA", count: 1, revenue: "50.0000", evRealised: "43.0000", evTarget: "42.4097", marginAbs: "7.0000", marginPct: "14.00", evRealisedVsTargetPct: "101.39" },
      ],
    },
    trades: { count: 3, gmv: "30.0000", feeRevenue: "1.5000" },
    auctions: { count: 1, gmv: "20.0000", feeRevenue: "2.0000", avgExtensions: "1.00", totalSettled: 1, cancelled: 0, closedNoWinner: 0 },
    platform: { totalRevenue: "53.5000", totalFeeRevenue: "3.5000", activeUsers: 3 },
    topUsers: [{ userId: "u1", email: "alice@x.com", totalSpend: "100.0000" }],
  };

  it("produces a well-formed CSV with headers and section markers", () => {
    const csv = snapshotToCsv(sample);
    expect(csv).toMatch(/metric,value/);
    expect(csv).toMatch(/=== Packs ===/);
    expect(csv).toMatch(/STARTER,10,50.0000/);
    expect(csv).toMatch(/alice@x.com,100.0000/);
  });

  it("quotes cells containing commas or quotes", () => {
    const s: EconomicsSnapshot = {
      ...sample,
      topUsers: [{ userId: "u1", email: 'alice "the kid", smith', totalSpend: "100.0000" }],
    };
    const csv = snapshotToCsv(s);
    expect(csv).toContain('"alice ""the kid"", smith"');
  });
});
