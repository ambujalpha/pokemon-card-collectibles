import { Rarity } from "@prisma/client";

import { RARITY_WEIGHTS, TIER_PITY, type TierName } from "./rarity-weights";

// Minimum card shape the picker needs. Callers can pass richer objects (e.g.
// full Prisma Card rows with basePrice) and TypeScript will accept them.
export interface PackPickerCard {
  id: string;
  rarityBucket: Rarity;
}

const BUCKETS: Rarity[] = ["COMMON", "UNCOMMON", "RARE", "EPIC", "LEGENDARY"];
const RARITY_ORDER: Record<Rarity, number> = {
  COMMON: 0,
  UNCOMMON: 1,
  RARE: 2,
  EPIC: 3,
  LEGENDARY: 4,
};
const CARDS_PER_PACK = 5;

export function pickCards<T extends PackPickerCard>(
  tier: TierName,
  cardPool: readonly T[],
  rng: () => number = Math.random,
): T[] {
  const weights = RARITY_WEIGHTS[tier];
  const pity = TIER_PITY[tier];

  const byBucket: Record<Rarity, T[]> = {
    COMMON: [],
    UNCOMMON: [],
    RARE: [],
    EPIC: [],
    LEGENDARY: [],
  };
  for (const c of cardPool) byBucket[c.rarityBucket].push(c);

  const picks: T[] = [];
  for (let i = 0; i < CARDS_PER_PACK; i++) {
    picks.push(pickOne(rng, byBucket, weights));
  }

  if (pity === "RARE") {
    const ok = picks.some((p) => RARITY_ORDER[p.rarityBucket] >= RARITY_ORDER.RARE);
    if (!ok) applyPity(picks, byBucket, "RARE", rng);
  } else if (pity === "EPIC") {
    const ok = picks.some((p) => RARITY_ORDER[p.rarityBucket] >= RARITY_ORDER.EPIC);
    if (!ok) applyPity(picks, byBucket, "EPIC", rng);
  }

  return picks;
}

function pickOne<T extends PackPickerCard>(
  rng: () => number,
  byBucket: Record<Rarity, T[]>,
  weights: Record<Rarity, number>,
): T {
  const rarity = pickRarity(rng, weights);
  const pool = byBucket[rarity];
  if (pool.length > 0) {
    return pool[Math.floor(rng() * pool.length)];
  }
  for (const b of BUCKETS) {
    if (byBucket[b].length > 0) {
      return byBucket[b][Math.floor(rng() * byBucket[b].length)];
    }
  }
  throw new Error("pack-picker: empty card pool");
}

function pickRarity(rng: () => number, weights: Record<Rarity, number>): Rarity {
  const r = rng();
  let acc = 0;
  for (const b of BUCKETS) {
    acc += weights[b];
    if (r <= acc) return b;
  }
  return "LEGENDARY";
}

function applyPity<T extends PackPickerCard>(
  picks: T[],
  byBucket: Record<Rarity, T[]>,
  minRarity: "RARE" | "EPIC",
  rng: () => number,
): void {
  // Replace the lowest-rarity card in the pack (below minRarity) with one of
  // minRarity. Usually a COMMON; falls through to UNCOMMON/RARE when the pack
  // happens to have none.
  const threshold = RARITY_ORDER[minRarity];
  let idx = -1;
  let lowestOrder = threshold;
  for (let i = 0; i < picks.length; i++) {
    const o = RARITY_ORDER[picks[i].rarityBucket];
    if (o < lowestOrder) {
      lowestOrder = o;
      idx = i;
    }
  }
  if (idx < 0) return;
  const pool = byBucket[minRarity];
  if (pool.length === 0) return;
  picks[idx] = pool[Math.floor(rng() * pool.length)];
}
