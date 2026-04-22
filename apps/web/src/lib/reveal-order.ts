import { Rarity } from "@prisma/client";

// Stable reveal ordering: least-valuable first, most-valuable last.
// Ties broken by the pack-picker's original slot (PackCard.position, 1..5),
// so a revisited pack shows cards in the same arrangement every time.

const RARITY_ORDINAL: Record<Rarity, number> = {
  COMMON: 0,
  UNCOMMON: 1,
  RARE: 2,
  EPIC: 3,
  LEGENDARY: 4,
};

export interface RevealCardInput {
  position: number;
  rarityBucket: Rarity;
}

export function sortPackCards<T extends RevealCardInput>(cards: readonly T[]): T[] {
  return [...cards].sort((a, b) => {
    const d = RARITY_ORDINAL[a.rarityBucket] - RARITY_ORDINAL[b.rarityBucket];
    if (d !== 0) return d;
    return a.position - b.position;
  });
}
