import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { allocateSpend } from "./spend-allocation";

function sum(strs: string[]): string {
  return strs.reduce((a, b) => a.add(b), new Prisma.Decimal(0)).toFixed(4);
}

describe("allocateSpend", () => {
  it("sums exactly to the pack tier price with rounding residual on the last card", () => {
    const out = allocateSpend(["1.0000", "2.0000", "3.0000"], "5.0000");
    expect(sum(out)).toBe("5.0000");
    expect(out).toHaveLength(3);
  });

  it("handles a realistic 10-card pack (Premium $20)", () => {
    const pricedCaptured = [
      "0.2500", "0.3100", "0.4200", "0.1900", "0.8500",
      "1.2000", "0.7300", "2.4000", "0.4100", "9.8000",
    ];
    const out = allocateSpend(pricedCaptured, "20.0000");
    expect(sum(out)).toBe("20.0000");
    // Largest card (9.80) should get the largest allocation.
    const maxIdx = out.reduce((bestI, v, i) =>
      new Prisma.Decimal(v).gt(out[bestI]) ? i : bestI, 0);
    expect(maxIdx).toBe(9);
  });

  it("distributes equally when pricedCaptured sums to zero", () => {
    const out = allocateSpend(["0", "0", "0", "0"], "5.0000");
    expect(sum(out)).toBe("5.0000");
    // First three get 1.25 each, last gets residual 1.25.
    expect(out[0]).toBe("1.2500");
  });

  it("returns empty array on empty input", () => {
    expect(allocateSpend([], "5.0000")).toEqual([]);
  });

  it("accepts mixed Decimal / string / number inputs", () => {
    const out = allocateSpend([new Prisma.Decimal("1"), "2", 3], 6);
    expect(sum(out)).toBe("6.0000");
  });
});
