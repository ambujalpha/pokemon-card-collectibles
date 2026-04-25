import { describe, expect, it } from "vitest";

import { RARITY_WEIGHTS } from "@/lib/rarity-weights";

import {
  CARDS_PER_PACK,
  SolverInfeasibleError,
  solveWeights,
  type BucketMeans,
  type TierConstraints,
  type WeightVector,
} from "./solver";
void SolverInfeasibleError;
import { WIN_RATE_FLOORS } from "./winRate";

// Representative bucket means (USD) — rough order-of-magnitude from the
// Paldea Evolved snapshot used in Part A. The numeric precision isn't load
// bearing here; we care that the solver hits the target EV exactly.
const BASELINE_MEANS: BucketMeans = {
  COMMON: 0.15,
  UNCOMMON: 0.4,
  RARE: 2.5,
  EPIC: 16.0,
  LEGENDARY: 120.0,
};

const TINY_FLOOR: WeightVector = {
  COMMON: 0,
  UNCOMMON: 0,
  RARE: 0,
  EPIC: 0,
  LEGENDARY: 0,
};

function constraintsFor(tier: "STARTER" | "PREMIUM" | "ULTRA"): TierConstraints {
  return { winRateFloor: WIN_RATE_FLOORS[tier], perBucketMin: TINY_FLOOR };
}

describe("solveWeights", () => {
  it.each([
    ["STARTER", 5, 0.35],
    ["PREMIUM", 20, 0.25],
    ["ULTRA", 50, 0.15],
  ] as const)("hits target EV exactly for %s", (tier, price, margin) => {
    const res = solveWeights({
      tier,
      tierPriceUsd: price,
      targetMargin: margin,
      bucketMeanUsd: BASELINE_MEANS,
      baseShape: RARITY_WEIGHTS[tier],
      constraints: constraintsFor(tier),
    });
    const targetEv = price * (1 - margin);
    // Within 0.01% (acceptance criterion).
    expect(Math.abs(res.evPerPackUsd - targetEv) / targetEv).toBeLessThan(0.0001);

    const sum =
      res.weights.COMMON +
      res.weights.UNCOMMON +
      res.weights.RARE +
      res.weights.EPIC +
      res.weights.LEGENDARY;
    expect(Math.abs(sum - 1)).toBeLessThan(1e-9);
  });

  it("respects win-rate floor for STARTER", () => {
    const res = solveWeights({
      tier: "STARTER",
      tierPriceUsd: 5,
      targetMargin: 0.35,
      bucketMeanUsd: BASELINE_MEANS,
      baseShape: RARITY_WEIGHTS.STARTER,
      constraints: constraintsFor("STARTER"),
    });
    expect(res.weights.COMMON + res.weights.UNCOMMON).toBeGreaterThanOrEqual(
      WIN_RATE_FLOORS.STARTER - 1e-9,
    );
  });

  it("shifts weight down on the rare buckets when SR prices spike 10×", () => {
    const baseline = solveWeights({
      tier: "ULTRA",
      tierPriceUsd: 50,
      targetMargin: 0.15,
      bucketMeanUsd: BASELINE_MEANS,
      baseShape: RARITY_WEIGHTS.ULTRA,
      constraints: constraintsFor("ULTRA"),
    });
    const spiked = solveWeights({
      tier: "ULTRA",
      tierPriceUsd: 50,
      targetMargin: 0.15,
      bucketMeanUsd: { ...BASELINE_MEANS, EPIC: BASELINE_MEANS.EPIC * 10 },
      baseShape: RARITY_WEIGHTS.ULTRA,
      constraints: constraintsFor("ULTRA"),
    });

    const highBaseline = baseline.weights.RARE + baseline.weights.EPIC + baseline.weights.LEGENDARY;
    const highSpiked = spiked.weights.RARE + spiked.weights.EPIC + spiked.weights.LEGENDARY;
    expect(highSpiked).toBeLessThan(highBaseline);
  });

  it("clamps to winRateFloor and reports constraintBinding when margin is too generous", () => {
    // 0% margin at ULTRA requires pushing mass into rare buckets below the
    // 0.60 win-rate floor. Solver clamps tLow up and marks the binding;
    // realised margin ends up above target (see ECONOMICS_SHIFT.md §1.4).
    const res = solveWeights({
      tier: "ULTRA",
      tierPriceUsd: 50,
      targetMargin: 0.0,
      bucketMeanUsd: BASELINE_MEANS,
      baseShape: RARITY_WEIGHTS.ULTRA,
      constraints: constraintsFor("ULTRA"),
    });
    expect(res.constraintBinding).toBe("winRateFloor");
    expect(res.weights.COMMON + res.weights.UNCOMMON).toBeCloseTo(
      WIN_RATE_FLOORS.ULTRA,
      9,
    );
    expect(res.realisedMargin).toBeGreaterThan(0);
  });

  it("throws when muHigh <= muLow (degenerate prices)", () => {
    const degenerate: BucketMeans = {
      COMMON: 10,
      UNCOMMON: 10,
      RARE: 1,
      EPIC: 1,
      LEGENDARY: 1,
    };
    expect(() =>
      solveWeights({
        tier: "PREMIUM",
        tierPriceUsd: 20,
        targetMargin: 0.25,
        bucketMeanUsd: degenerate,
        baseShape: RARITY_WEIGHTS.PREMIUM,
        constraints: constraintsFor("PREMIUM"),
      }),
    ).toThrow(SolverInfeasibleError);
  });

  it("returns a pack EV equal to 5× the per-card EV", () => {
    const res = solveWeights({
      tier: "PREMIUM",
      tierPriceUsd: 20,
      targetMargin: 0.25,
      bucketMeanUsd: BASELINE_MEANS,
      baseShape: RARITY_WEIGHTS.PREMIUM,
      constraints: constraintsFor("PREMIUM"),
    });
    const perCardEv =
      res.weights.COMMON * BASELINE_MEANS.COMMON +
      res.weights.UNCOMMON * BASELINE_MEANS.UNCOMMON +
      res.weights.RARE * BASELINE_MEANS.RARE +
      res.weights.EPIC * BASELINE_MEANS.EPIC +
      res.weights.LEGENDARY * BASELINE_MEANS.LEGENDARY;
    expect(Math.abs(res.evPerPackUsd - CARDS_PER_PACK * perCardEv)).toBeLessThan(1e-9);
  });
});
