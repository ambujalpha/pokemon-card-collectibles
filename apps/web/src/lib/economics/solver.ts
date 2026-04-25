import { Rarity } from "@prisma/client";

import type { TierName } from "@/lib/rarity-weights";

// Closed-form pack weight solver.
//
// Inputs:
//   - Tier price P and target margin m → target EV per pack E = P*(1-m).
//   - Mean bucket prices μ_0…μ_4 (COMMON..LEGENDARY) from the latest price
//     snapshot.
//   - A `baseShape` vector defining the *ratio structure* inside the low
//     subset (COMMON+UNCOMMON) and the high subset (RARE+EPIC+LEGENDARY).
//     The solver preserves these internal ratios and only moves mass
//     *between* the two subsets.
//   - Per-tier constraints: a win-rate floor on (COMMON+UNCOMMON) mass and
//     per-bucket minimum weights.
//
// The weight vector w lives on the simplex (Σw=1, w≥0). We parametrise the
// single degree of freedom by T_low = w_COMMON+w_UNCOMMON. Given fixed
// internal ratios, EV per card is linear in T_low, so the EV equation
// solves directly.
//
// See docs/economics/ECONOMICS_SHIFT.md §1.2 for why this avoids an LP
// solver, and §1.4 for the win-rate floor rationale.

export const CARDS_PER_PACK = 5;

export const BUCKETS: Rarity[] = [
  "COMMON",
  "UNCOMMON",
  "RARE",
  "EPIC",
  "LEGENDARY",
];

export type BucketMeans = Record<Rarity, number>;
export type WeightVector = Record<Rarity, number>;

export interface TierConstraints {
  /** Minimum combined mass on COMMON+UNCOMMON. See ECONOMICS_SHIFT.md §1.4. */
  winRateFloor: number;
  /** Per-bucket minimum weight (usually a small epsilon for diversity). */
  perBucketMin: WeightVector;
}

export interface SolveInput {
  tier: TierName;
  tierPriceUsd: number;
  targetMargin: number;
  bucketMeanUsd: BucketMeans;
  baseShape: WeightVector;
  constraints: TierConstraints;
}

export type ConstraintBinding = "winRateFloor" | "lowMax" | null;

export interface SolveResult {
  tier: TierName;
  weights: WeightVector;
  evPerPackUsd: number;
  targetEvPerPackUsd: number;
  realisedMargin: number;
  tLow: number;
  tHigh: number;
  /**
   * Non-null when a constraint *bound* (rather than the EV target) determined
   * the solution. `winRateFloor` ⇒ the unclamped EV-minimising solution would
   * have let in too few wins; we clamped up, so realised margin ≥ target.
   */
  constraintBinding: ConstraintBinding;
}

export class SolverInfeasibleError extends Error {
  constructor(
    message: string,
    readonly diagnostics: Record<string, number | string>,
  ) {
    super(message);
    this.name = "SolverInfeasibleError";
  }
}

export function solveWeights(input: SolveInput): SolveResult {
  const { tier, tierPriceUsd, targetMargin, bucketMeanUsd, baseShape, constraints } = input;

  const targetEvPerPack = tierPriceUsd * (1 - targetMargin);
  const targetEvPerCard = targetEvPerPack / CARDS_PER_PACK;

  const shapeLowSum = baseShape.COMMON + baseShape.UNCOMMON;
  const shapeHighSum = baseShape.RARE + baseShape.EPIC + baseShape.LEGENDARY;
  if (shapeLowSum <= 0 || shapeHighSum <= 0) {
    const msg = "baseShape must have positive mass in both low and high subsets";
    throw new SolverInfeasibleError(msg, { shapeLowSum, shapeHighSum });
  }

  const rCommon = baseShape.COMMON / shapeLowSum;
  const rUncommon = baseShape.UNCOMMON / shapeLowSum;
  const rRare = baseShape.RARE / shapeHighSum;
  const rEpic = baseShape.EPIC / shapeHighSum;
  const rLeg = baseShape.LEGENDARY / shapeHighSum;

  const muLow =
    rCommon * bucketMeanUsd.COMMON + rUncommon * bucketMeanUsd.UNCOMMON;
  const muHigh =
    rRare * bucketMeanUsd.RARE +
    rEpic * bucketMeanUsd.EPIC +
    rLeg * bucketMeanUsd.LEGENDARY;

  if (muHigh <= muLow) {
    const msg = "high-subset mean must exceed low-subset mean for solver to be well-posed";
    throw new SolverInfeasibleError(msg, { muLow, muHigh });
  }

  // EV(T_low) = T_low * muLow + (1 - T_low) * muHigh
  //          = muHigh - T_low * (muHigh - muLow)
  // Solve EV = targetEvPerCard.
  const tLowUnclamped = (muHigh - targetEvPerCard) / (muHigh - muLow);

  const perBucketFloorLow = constraints.perBucketMin.COMMON + constraints.perBucketMin.UNCOMMON;
  const perBucketFloorHigh =
    constraints.perBucketMin.RARE +
    constraints.perBucketMin.EPIC +
    constraints.perBucketMin.LEGENDARY;

  const lowMin = Math.max(constraints.winRateFloor, perBucketFloorLow);
  const lowMax = 1 - perBucketFloorHigh;

  if (lowMin > lowMax) {
    throw new SolverInfeasibleError("per-bucket minima exceed simplex", {
      lowMin,
      lowMax,
    });
  }

  // Clamp to the feasible interval. When the win-rate floor binds, realised
  // margin ends up above target (house richer) — acceptable per policy, see
  // ECONOMICS_SHIFT.md §1.4.
  let tLow = tLowUnclamped;
  let constraintBinding: ConstraintBinding = null;
  if (tLow < lowMin) {
    tLow = lowMin;
    constraintBinding = "winRateFloor";
  } else if (tLow > lowMax) {
    tLow = lowMax;
    constraintBinding = "lowMax";
  }

  const tHigh = 1 - tLow;

  const weights: WeightVector = {
    COMMON: tLow * rCommon,
    UNCOMMON: tLow * rUncommon,
    RARE: tHigh * rRare,
    EPIC: tHigh * rEpic,
    LEGENDARY: tHigh * rLeg,
  };

  // Post-check per-bucket minima; if any bucket shape is extreme enough to
  // violate its floor, the result is still not a hard failure — the
  // business-acceptable fix is to raise the floor. We surface via
  // SolverInfeasibleError so the admin sees it.
  for (const b of BUCKETS) {
    if (weights[b] < constraints.perBucketMin[b] - 1e-9) {
      throw new SolverInfeasibleError(
        `bucket ${b} weight below per-bucket minimum`,
        {
          tier,
          bucket: b,
          weight: weights[b],
          min: constraints.perBucketMin[b],
        },
      );
    }
  }

  const evPerPack =
    CARDS_PER_PACK *
    (weights.COMMON * bucketMeanUsd.COMMON +
      weights.UNCOMMON * bucketMeanUsd.UNCOMMON +
      weights.RARE * bucketMeanUsd.RARE +
      weights.EPIC * bucketMeanUsd.EPIC +
      weights.LEGENDARY * bucketMeanUsd.LEGENDARY);

  const realisedMargin = (tierPriceUsd - evPerPack) / tierPriceUsd;

  return {
    tier,
    weights,
    evPerPackUsd: evPerPack,
    targetEvPerPackUsd: targetEvPerPack,
    realisedMargin,
    tLow,
    tHigh,
    constraintBinding,
  };
}
