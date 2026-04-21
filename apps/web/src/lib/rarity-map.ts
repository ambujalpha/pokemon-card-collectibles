import { Rarity } from "@prisma/client";

// pokemontcg.io exposes a wide set of rarity strings. We collapse them into our
// 5-bucket taxonomy so rarity weights in rarity-weights.ts stay simple and
// auditable. The calibration script tunes weights against real prices, so the
// bucket mapping primarily drives which cards sit in which bucket, not the EV.
// See docs/plan/PHASE_1.md §2.2 for the rationale.
export const RARITY_MAP: Record<string, Rarity> = {
  Common: Rarity.COMMON,
  Uncommon: Rarity.UNCOMMON,
  Rare: Rarity.RARE,
  "Rare Holo": Rarity.RARE,
  "Double Rare": Rarity.RARE,
  "Rare Ultra": Rarity.EPIC,
  "Ultra Rare": Rarity.EPIC,
  "Rare Holo EX": Rarity.EPIC,
  "Rare Holo GX": Rarity.EPIC,
  "Rare Holo V": Rarity.EPIC,
  "Rare Holo VMAX": Rarity.EPIC,
  "Illustration Rare": Rarity.EPIC,
  "Shiny Rare": Rarity.EPIC,
  "Special Illustration Rare": Rarity.LEGENDARY,
  "Hyper Rare": Rarity.LEGENDARY,
  "Rare Secret": Rarity.LEGENDARY,
  "Shiny Ultra Rare": Rarity.LEGENDARY,
  "Rare Rainbow": Rarity.LEGENDARY,
};

export function mapRarity(tcgRarity: string | null | undefined): Rarity | null {
  if (!tcgRarity) return null;
  return RARITY_MAP[tcgRarity] ?? null;
}
