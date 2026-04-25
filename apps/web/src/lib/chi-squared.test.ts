import { describe, expect, it } from "vitest";

import { chiSquaredGof } from "./chi-squared";

describe("chiSquaredGof", () => {
  it("matches expected — uniform observed against uniform expected", () => {
    const observed = [25, 25, 25, 25];
    const expected = [0.25, 0.25, 0.25, 0.25];
    const r = chiSquaredGof(observed, expected);
    expect(r.chi2).toBeCloseTo(0, 9);
    expect(r.pValue).toBeGreaterThan(0.99);
  });

  it("returns small p-value when distribution clearly disagrees", () => {
    const observed = [80, 5, 10, 5];
    const expected = [0.25, 0.25, 0.25, 0.25];
    const r = chiSquaredGof(observed, expected);
    expect(r.chi2).toBeGreaterThan(50);
    expect(r.pValue).toBeLessThan(0.001);
  });

  it("approximates known fixture chi-squared values within ~5%", () => {
    // Known: observed=[10,10,10,10], expected uniform — chi2 = 0
    expect(chiSquaredGof([10, 10, 10, 10], [0.25, 0.25, 0.25, 0.25]).chi2).toBe(0);
    // Known: observed=[18, 22, 30, 30], expected uniform 100.
    // (-7² + -3² + 5² + 5²) / 25 = 49/25 + 9/25 + 25/25 + 25/25 = 4.32
    const r = chiSquaredGof([18, 22, 30, 30], [0.25, 0.25, 0.25, 0.25]);
    expect(r.chi2).toBeCloseTo(4.32, 9);
  });
});
