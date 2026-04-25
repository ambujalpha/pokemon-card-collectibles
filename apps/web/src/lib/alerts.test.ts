import { describe, expect, it } from "vitest";

import {
  ALERT_THRESHOLDS,
  evalBotSpike,
  evalChiSquared,
  evalMarginDrift,
} from "./alerts";

describe("evalMarginDrift", () => {
  it("returns null inside the green band", () => {
    expect(evalMarginDrift("PREMIUM", 0.27, 0.25)).toBeNull();
  });

  it("returns yellow above the yellow threshold", () => {
    const out = evalMarginDrift("PREMIUM", 0.30, 0.25);
    expect(out?.severity).toBe("yellow");
  });

  it("returns red above the red threshold", () => {
    const out = evalMarginDrift("STARTER", 0.25, 0.35);
    expect(out?.severity).toBe("red");
  });

  it("uses the documented thresholds", () => {
    expect(ALERT_THRESHOLDS.marginDrift.yellowPp).toBe(0.03);
    expect(ALERT_THRESHOLDS.marginDrift.redPp).toBe(0.06);
  });
});

describe("evalChiSquared", () => {
  it("ignores high p-values", () => {
    expect(evalChiSquared("ULTRA", 0.5, 4)).toBeNull();
  });

  it("flags yellow on borderline p", () => {
    const out = evalChiSquared("ULTRA", 0.04, 4);
    expect(out?.severity).toBe("yellow");
  });

  it("flags red on small p", () => {
    const out = evalChiSquared("ULTRA", 0.005, 4);
    expect(out?.severity).toBe("red");
  });
});

describe("evalBotSpike", () => {
  it("ignores zero baseline (cold start)", () => {
    expect(evalBotSpike(10, 0)).toBeNull();
  });

  it("yellow at 1.6×", () => {
    const out = evalBotSpike(16, 10);
    expect(out?.severity).toBe("yellow");
  });

  it("red at 3×", () => {
    const out = evalBotSpike(30, 10);
    expect(out?.severity).toBe("red");
  });
});
