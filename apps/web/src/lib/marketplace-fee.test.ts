import { describe, expect, it } from "vitest";

import { computeTradeFee } from "./marketplace-fee";

describe("computeTradeFee", () => {
  it("5% of 20.00 is 1.00 fee / 19.00 seller net", () => {
    expect(computeTradeFee("20.00")).toEqual({ fee: "1.0000", sellerNet: "19.0000" });
  });

  it("ceils fractional cents upward (seller eats rounding)", () => {
    // 5% of 1.01 = 0.0505 → ceil to 0.0600 (0.06)? No — ceil-to-cent = 0.06.
    // Wait: 0.0505 * 100 = 5.05 → ceil → 6 → 0.06.
    expect(computeTradeFee("1.01")).toEqual({ fee: "0.0600", sellerNet: "0.9500" });
  });

  it("exact cent values don't get ceiled further", () => {
    // 5% of 10.00 = 0.50 exactly → fee 0.50 (no ceil).
    expect(computeTradeFee("10.00")).toEqual({ fee: "0.5000", sellerNet: "9.5000" });
  });

  it("handles small values safely", () => {
    // 5% of 0.01 = 0.0005 → ceil-to-cent = 0.01.
    expect(computeTradeFee("0.01")).toEqual({ fee: "0.0100", sellerNet: "0.0000" });
  });

  it("high-precision ask still yields 4-decimal outputs", () => {
    const out = computeTradeFee("123.4567");
    expect(out.fee).toMatch(/^\d+\.\d{4}$/);
    expect(out.sellerNet).toMatch(/^\d+\.\d{4}$/);
  });
});
