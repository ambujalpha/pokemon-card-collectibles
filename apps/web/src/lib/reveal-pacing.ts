import { Rarity } from "@prisma/client";

// Per-card flip animation duration. Scales with rarity so the Legendary
// lands as the climax of the pack. Design locked 2026-04-21.
export const FLIP_MS: Record<Rarity, number> = {
  COMMON: 600,
  UNCOMMON: 800,
  RARE: 1200,
  EPIC: 1800,
  LEGENDARY: 2500,
};

// Small gap between one card finishing and the next starting to flip.
export const INTER_CARD_GAP_MS = 100;

export function flipDuration(rarity: Rarity): number {
  return FLIP_MS[rarity];
}

export function totalRevealMs(rarities: readonly Rarity[]): number {
  if (rarities.length === 0) return 0;
  const flips = rarities.reduce((sum, r) => sum + FLIP_MS[r], 0);
  const gaps = (rarities.length - 1) * INTER_CARD_GAP_MS;
  return flips + gaps;
}
