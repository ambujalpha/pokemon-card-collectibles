import { Rarity } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { pickCards, type PackPickerCard } from "./pack-picker";
import { RARITY_WEIGHTS } from "./rarity-weights";

function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = t;
    r = Math.imul(r ^ (r >>> 15), r | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function buildPool(countPerBucket: Record<Rarity, number>): PackPickerCard[] {
  const pool: PackPickerCard[] = [];
  for (const [rarity, count] of Object.entries(countPerBucket) as [Rarity, number][]) {
    for (let i = 0; i < count; i++) {
      pool.push({ id: `${rarity}-${i}`, rarityBucket: rarity });
    }
  }
  return pool;
}

const BALANCED_POOL = buildPool({ COMMON: 60, UNCOMMON: 50, RARE: 30, EPIC: 50, LEGENDARY: 10 });

describe("pack-picker", () => {
  it("returns exactly 5 cards", () => {
    const pack = pickCards("STARTER", BALANCED_POOL, mulberry32(1));
    expect(pack).toHaveLength(5);
  });

  it("empirical STARTER distribution is within 1pp of tuned weights over 100k draws", () => {
    const rng = mulberry32(42);
    const counts: Record<Rarity, number> = { COMMON: 0, UNCOMMON: 0, RARE: 0, EPIC: 0, LEGENDARY: 0 };
    const n = 20_000;
    for (let i = 0; i < n; i++) {
      for (const card of pickCards("STARTER", BALANCED_POOL, rng)) {
        counts[card.rarityBucket]++;
      }
    }
    const total = n * 5;
    for (const b of ["COMMON", "UNCOMMON", "RARE", "EPIC", "LEGENDARY"] as Rarity[]) {
      const observed = counts[b] / total;
      const expected = RARITY_WEIGHTS.STARTER[b];
      // 1 percentage point tolerance for LEGENDARY/EPIC (small weights → high SE).
      expect(Math.abs(observed - expected), `${b}: observed ${observed.toFixed(4)} vs expected ${expected.toFixed(4)}`).toBeLessThan(0.01);
    }
  });

  it("PREMIUM pity: every pack has ≥1 RARE or higher", () => {
    const rng = mulberry32(7);
    for (let i = 0; i < 5_000; i++) {
      const pack = pickCards("PREMIUM", BALANCED_POOL, rng);
      const best = pack.some((c) => ["RARE", "EPIC", "LEGENDARY"].includes(c.rarityBucket));
      expect(best, `pack ${i} has no RARE+`).toBe(true);
    }
  });

  it("ULTRA pity: every pack has ≥1 EPIC or higher", () => {
    const rng = mulberry32(9);
    for (let i = 0; i < 5_000; i++) {
      const pack = pickCards("ULTRA", BALANCED_POOL, rng);
      const best = pack.some((c) => ["EPIC", "LEGENDARY"].includes(c.rarityBucket));
      expect(best, `pack ${i} has no EPIC+`).toBe(true);
    }
  });

  it("STARTER has no pity and can produce packs without RARE+", () => {
    const rng = mulberry32(11);
    let noRarePlusCount = 0;
    for (let i = 0; i < 2_000; i++) {
      const pack = pickCards("STARTER", BALANCED_POOL, rng);
      const hasRarePlus = pack.some((c) => ["RARE", "EPIC", "LEGENDARY"].includes(c.rarityBucket));
      if (!hasRarePlus) noRarePlusCount++;
    }
    expect(noRarePlusCount).toBeGreaterThan(0);
  });
});
