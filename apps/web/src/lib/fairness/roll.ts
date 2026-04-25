import { createHmac } from "node:crypto";

import { Rarity } from "@prisma/client";

import type { WeightVector } from "@/lib/active-weights";

// Deterministic pack roll.
//
// Inputs: server_seed (hex), client_seed (string), nonce (string).
// Output: 5 rarity slots + sub-stream hashes for picking the actual card
// id within each slot.
//
// The maths must be reproducible exactly in the browser verifier
// (`/verify/pack/:id`), so anything not in this file must be re-derivable
// from public information.

export const CARDS_PER_PACK = 5;
const BUCKETS: Rarity[] = ["COMMON", "UNCOMMON", "RARE", "EPIC", "LEGENDARY"];

export interface RollResult {
  /** Per-slot uniform [0,1) used to pick a rarity. */
  slotUniforms: number[];
  /** Per-slot rarity bucket selected from `weights`. */
  slotRarities: Rarity[];
  /** Per-slot uniform [0,1) used to pick a card *within* the chosen bucket. */
  cardUniforms: number[];
}

export function rollPack(
  serverSeedHex: string,
  clientSeed: string,
  nonce: string,
  weights: WeightVector,
): RollResult {
  // Two HMAC chains: one for rarity selection, one for in-bucket card pick.
  // The second chain depends on slot index so it can't reuse rarity entropy.
  const rarityBytes = hmacSha256(serverSeedHex, `${clientSeed}:${nonce}:rarity`);
  const cardBytes = hmacSha256(serverSeedHex, `${clientSeed}:${nonce}:card`);

  const slotUniforms: number[] = [];
  const slotRarities: Rarity[] = [];
  const cardUniforms: number[] = [];

  // Each HMAC output is 32 bytes; we slice 6 bytes (48 bits) per slot.
  // 5 slots × 6 = 30 bytes, well within 32.
  for (let i = 0; i < CARDS_PER_PACK; i++) {
    const u1 = bytesToUniform48(rarityBytes, i * 6);
    const u2 = bytesToUniform48(cardBytes, i * 6);
    slotUniforms.push(u1);
    slotRarities.push(pickRarity(u1, weights));
    cardUniforms.push(u2);
  }

  return { slotUniforms, slotRarities, cardUniforms };
}

function pickRarity(u: number, weights: WeightVector): Rarity {
  let acc = 0;
  for (const b of BUCKETS) {
    acc += weights[b];
    if (u <= acc) return b;
  }
  return "LEGENDARY";
}

function hmacSha256(keyHex: string, msg: string): Buffer {
  return createHmac("sha256", Buffer.from(keyHex, "hex")).update(msg).digest();
}

function bytesToUniform48(buf: Buffer, offset: number): number {
  // Read 6 bytes big-endian, interpret as 48-bit unsigned int, divide by 2^48.
  const hi = buf.readUInt16BE(offset);
  const lo = buf.readUInt32BE(offset + 2);
  const n = hi * 2 ** 32 + lo;
  return n / 2 ** 48;
}

// ─── Card-pool helpers (server-side only) ──────────────────────────────────

interface PoolCard {
  id: string;
  rarityBucket: Rarity;
}

export function applyRollToPool<T extends PoolCard>(
  roll: RollResult,
  pool: readonly T[],
): T[] {
  const byBucket: Record<Rarity, T[]> = {
    COMMON: [], UNCOMMON: [], RARE: [], EPIC: [], LEGENDARY: [],
  };
  for (const c of pool) byBucket[c.rarityBucket].push(c);
  // Sort each bucket by id so the verifier can reproduce ordering.
  for (const b of BUCKETS) byBucket[b].sort((a, b2) => a.id.localeCompare(b2.id));

  const picks: T[] = [];
  for (let i = 0; i < CARDS_PER_PACK; i++) {
    const r = roll.slotRarities[i]!;
    let pool = byBucket[r];
    if (pool.length === 0) {
      // Fallback to first non-empty bucket — same rule as pack-picker.ts.
      for (const b of BUCKETS) if (byBucket[b].length > 0) { pool = byBucket[b]; break; }
    }
    if (pool.length === 0) throw new Error("fairness: empty card pool");
    const idx = Math.floor(roll.cardUniforms[i]! * pool.length);
    picks.push(pool[idx]!);
  }
  return picks;
}
