import type { TierName } from "@/lib/rarity-weights";

// "Win" = pack payout ≥ WIN_FRACTION × tier price.
// Floor = minimum share of packs that must be wins under the solver output.
// See docs/economics/ECONOMICS_SHIFT.md §1.4.

export const WIN_FRACTION = 0.6;

export const WIN_RATE_FLOORS: Record<TierName, number> = {
  STARTER: 0.4,
  PREMIUM: 0.5,
  ULTRA: 0.6,
};

export function isWin(tierPriceUsd: number, packPayoutUsd: number): boolean {
  return packPayoutUsd >= WIN_FRACTION * tierPriceUsd;
}
