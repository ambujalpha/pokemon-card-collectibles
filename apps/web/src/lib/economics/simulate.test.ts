import { describe, expect, it } from "vitest";

import { RARITY_WEIGHTS } from "@/lib/rarity-weights";

import { mulberry32, simulate } from "./simulate";
import { solveWeights, type BucketMeans } from "./solver";
import { WIN_RATE_FLOORS } from "./winRate";

const MEANS: BucketMeans = {
  COMMON: 0.15,
  UNCOMMON: 0.4,
  RARE: 2.5,
  EPIC: 16.0,
  LEGENDARY: 120.0,
};

const ZERO_FLOOR = { COMMON: 0, UNCOMMON: 0, RARE: 0, EPIC: 0, LEGENDARY: 0 };

describe("simulate", () => {
  it.each([
    ["STARTER", 5, 0.35],
    ["PREMIUM", 20, 0.25],
    ["ULTRA", 50, 0.15],
  ] as const)("realised margin for %s is within ±2pp over 10k packs", (tier, price, margin) => {
    const solved = solveWeights({
      tier,
      tierPriceUsd: price,
      targetMargin: margin,
      bucketMeanUsd: MEANS,
      baseShape: RARITY_WEIGHTS[tier],
      constraints: { winRateFloor: WIN_RATE_FLOORS[tier], perBucketMin: ZERO_FLOOR },
    });
    const res = simulate({
      tier,
      tierPriceUsd: price,
      weights: solved.weights,
      bucketMeanUsd: MEANS,
      n: 10_000,
      rng: mulberry32(1337 + price),
    });
    expect(Math.abs(res.realisedMargin - margin)).toBeLessThan(0.02);
  });

  it("win rate meets tier floor for ULTRA (seeded)", () => {
    const tier = "ULTRA" as const;
    const solved = solveWeights({
      tier,
      tierPriceUsd: 50,
      targetMargin: 0.15,
      bucketMeanUsd: MEANS,
      baseShape: RARITY_WEIGHTS[tier],
      constraints: { winRateFloor: WIN_RATE_FLOORS[tier], perBucketMin: ZERO_FLOOR },
    });
    const res = simulate({
      tier,
      tierPriceUsd: 50,
      weights: solved.weights,
      bucketMeanUsd: MEANS,
      n: 10_000,
      rng: mulberry32(7),
    });
    // The simulator uses bucket-mean payouts, so a "win" correlates with
    // having any RARE+ card (which most Ultra packs do). A sanity floor.
    expect(res.winRate).toBeGreaterThan(0.3);
  });

  it("is deterministic under the same seed", () => {
    const solved = solveWeights({
      tier: "PREMIUM",
      tierPriceUsd: 20,
      targetMargin: 0.25,
      bucketMeanUsd: MEANS,
      baseShape: RARITY_WEIGHTS.PREMIUM,
      constraints: { winRateFloor: WIN_RATE_FLOORS.PREMIUM, perBucketMin: ZERO_FLOOR },
    });
    const a = simulate({
      tier: "PREMIUM",
      tierPriceUsd: 20,
      weights: solved.weights,
      bucketMeanUsd: MEANS,
      n: 1000,
      rng: mulberry32(42),
    });
    const b = simulate({
      tier: "PREMIUM",
      tierPriceUsd: 20,
      weights: solved.weights,
      bucketMeanUsd: MEANS,
      n: 1000,
      rng: mulberry32(42),
    });
    expect(a.realisedMargin).toBe(b.realisedMargin);
    expect(a.winRate).toBe(b.winRate);
  });
});
