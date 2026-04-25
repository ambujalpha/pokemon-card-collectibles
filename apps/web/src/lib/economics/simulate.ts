import { Rarity } from "@prisma/client";

import type { TierName } from "@/lib/rarity-weights";

import { BUCKETS, CARDS_PER_PACK, type BucketMeans, type WeightVector } from "./solver";
import { isWin } from "./winRate";

// Seeded Monte Carlo over N pack openings. Used by both the unit tests and
// the admin simulate route. Cards are modelled at bucket-mean granularity;
// per-card variance isn't modelled because the solver works on means only
// (see ECONOMICS_SHIFT.md §1.3).

export interface SimulateInput {
  tier: TierName;
  tierPriceUsd: number;
  weights: WeightVector;
  bucketMeanUsd: BucketMeans;
  n: number;
  rng?: () => number;
}

export interface SimulateResult {
  tier: TierName;
  n: number;
  totalRevenueUsd: number;
  totalPayoutUsd: number;
  realisedMargin: number;
  winRate: number;
  bucketHitRates: Record<Rarity, number>;
}

export function simulate(input: SimulateInput): SimulateResult {
  const { tier, tierPriceUsd, weights, bucketMeanUsd, n } = input;
  const rng = input.rng ?? Math.random;

  const cum: { rarity: Rarity; edge: number }[] = [];
  let acc = 0;
  for (const b of BUCKETS) {
    acc += weights[b];
    cum.push({ rarity: b, edge: acc });
  }

  const counts: Record<Rarity, number> = {
    COMMON: 0,
    UNCOMMON: 0,
    RARE: 0,
    EPIC: 0,
    LEGENDARY: 0,
  };

  let totalPayout = 0;
  let wins = 0;

  for (let p = 0; p < n; p++) {
    let packPayout = 0;
    for (let c = 0; c < CARDS_PER_PACK; c++) {
      const r = rng();
      let pick: Rarity = "LEGENDARY";
      for (const { rarity, edge } of cum) {
        if (r <= edge) {
          pick = rarity;
          break;
        }
      }
      counts[pick]++;
      packPayout += bucketMeanUsd[pick];
    }
    totalPayout += packPayout;
    if (isWin(tierPriceUsd, packPayout)) wins++;
  }

  const totalRevenue = tierPriceUsd * n;
  const realisedMargin = (totalRevenue - totalPayout) / totalRevenue;
  const cards = n * CARDS_PER_PACK;

  const bucketHitRates: Record<Rarity, number> = {
    COMMON: counts.COMMON / cards,
    UNCOMMON: counts.UNCOMMON / cards,
    RARE: counts.RARE / cards,
    EPIC: counts.EPIC / cards,
    LEGENDARY: counts.LEGENDARY / cards,
  };

  return {
    tier,
    n,
    totalRevenueUsd: totalRevenue,
    totalPayoutUsd: totalPayout,
    realisedMargin,
    winRate: wins / n,
    bucketHitRates,
  };
}

// Deterministic PRNG for tests and reproducible admin simulations.
export function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = t;
    r = Math.imul(r ^ (r >>> 15), r | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}
