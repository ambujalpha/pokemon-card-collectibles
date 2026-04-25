import type { TierName } from "@/lib/rarity-weights";

// "Win" = pack payout ≥ WIN_FRACTION × tier price.
// Floor = minimum share of packs that must be wins under the solver output.
// Higher tiers have stricter floors: a $50 buyer should expect more
// frequent wins than a $5 one.

export const WIN_FRACTION = 0.6;

export const WIN_RATE_FLOORS: Record<TierName, number> = {
  STARTER: 0.4,
  PREMIUM: 0.5,
  ULTRA: 0.6,
};

export function isWin(tierPriceUsd: number, packPayoutUsd: number): boolean {
  return packPayoutUsd >= WIN_FRACTION * tierPriceUsd;
}
