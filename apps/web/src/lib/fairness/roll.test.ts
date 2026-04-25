import { Rarity } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { newCommit, verifyCommit } from "./commit";
import { rollPack, applyRollToPool, CARDS_PER_PACK } from "./roll";

const WEIGHTS = {
  COMMON: 0.7,
  UNCOMMON: 0.2,
  RARE: 0.05,
  EPIC: 0.04,
  LEGENDARY: 0.01,
} as const;

describe("rollPack", () => {
  it("produces CARDS_PER_PACK slot rarities + uniforms", () => {
    const r = rollPack("ab".repeat(32), "client", "nonce-1", WEIGHTS);
    expect(r.slotUniforms).toHaveLength(CARDS_PER_PACK);
    expect(r.slotRarities).toHaveLength(CARDS_PER_PACK);
    expect(r.cardUniforms).toHaveLength(CARDS_PER_PACK);
  });

  it("is deterministic under identical inputs", () => {
    const a = rollPack("ab".repeat(32), "c", "n", WEIGHTS);
    const b = rollPack("ab".repeat(32), "c", "n", WEIGHTS);
    expect(a).toEqual(b);
  });

  it("differs when nonce differs", () => {
    const a = rollPack("ab".repeat(32), "c", "n1", WEIGHTS);
    const b = rollPack("ab".repeat(32), "c", "n2", WEIGHTS);
    expect(a).not.toEqual(b);
  });

  it("differs when client seed differs", () => {
    const a = rollPack("ab".repeat(32), "x", "n", WEIGHTS);
    const b = rollPack("ab".repeat(32), "y", "n", WEIGHTS);
    expect(a).not.toEqual(b);
  });

  it("uniforms are in [0, 1)", () => {
    const r = rollPack("ab".repeat(32), "c", "n", WEIGHTS);
    for (const u of [...r.slotUniforms, ...r.cardUniforms]) {
      expect(u).toBeGreaterThanOrEqual(0);
      expect(u).toBeLessThan(1);
    }
  });
});

describe("applyRollToPool", () => {
  it("returns CARDS_PER_PACK cards from the pool", () => {
    const pool: { id: string; rarityBucket: Rarity }[] = [];
    for (const r of ["COMMON", "UNCOMMON", "RARE", "EPIC", "LEGENDARY"] as Rarity[]) {
      for (let i = 0; i < 10; i++) pool.push({ id: `${r}-${i}`, rarityBucket: r });
    }
    const roll = rollPack("ab".repeat(32), "c", "n", WEIGHTS);
    const picks = applyRollToPool(roll, pool);
    expect(picks).toHaveLength(CARDS_PER_PACK);
    for (const p of picks) {
      expect(pool.find((c) => c.id === p.id)).toBeTruthy();
    }
  });

  it("is deterministic given the same roll + pool", () => {
    const pool: { id: string; rarityBucket: Rarity }[] = [];
    for (const r of ["COMMON", "UNCOMMON", "RARE", "EPIC", "LEGENDARY"] as Rarity[]) {
      for (let i = 0; i < 10; i++) pool.push({ id: `${r}-${i}`, rarityBucket: r });
    }
    const roll = rollPack("cd".repeat(32), "c", "n", WEIGHTS);
    expect(applyRollToPool(roll, pool)).toEqual(applyRollToPool(roll, pool));
  });
});

describe("commit", () => {
  it("verifyCommit accepts the matching seed", () => {
    const c = newCommit("client-seed");
    expect(verifyCommit(c.serverSeedHex, c.serverSeedHashHex)).toBe(true);
  });

  it("verifyCommit rejects a tampered seed", () => {
    const c = newCommit("client-seed");
    const tampered = "00".repeat(32);
    expect(verifyCommit(tampered, c.serverSeedHashHex)).toBe(false);
  });

  it("auto-generates a client seed when one isn't supplied", () => {
    const c = newCommit(undefined);
    expect(c.clientSeed.length).toBeGreaterThan(0);
  });
});
