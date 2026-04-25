import { Rarity } from "@prisma/client";

import { prisma } from "@/lib/db";
import type { TierName } from "@/lib/rarity-weights";
import { RARITY_WEIGHTS } from "@/lib/rarity-weights";

// Version-aware rarity weight reader.
//
// The purchase route reads the *active* version to pick cards and pins
// `user_packs.weight_version_id` so the audit trail is fixed. Any reveal or
// audit path that needs the exact weights a pack was drawn against reads
// `getPinnedWeights(versionId)` — NOT the active weights. This guarantees
// that rebalancing between purchase and reveal cannot change what a user
// opens.
//
// Cache: a process-local map keyed by tier with a TTL. Invalidated by the
// rebalance route via `invalidateActiveWeights`. TTL is intentionally short
// so a rebalance that forgets to invalidate still self-heals within the
// window.

export type WeightVector = Record<Rarity, number>;

export const PACK_WEIGHT_TTL_MS = 60_000;

interface CacheEntry {
  versionId: string;
  weights: WeightVector;
  fetchedAt: number;
}

const cache = new Map<TierName, CacheEntry>();

export interface ActiveWeights {
  versionId: string | null;
  weights: WeightVector;
}

export async function getActiveWeights(tier: TierName): Promise<ActiveWeights> {
  const now = Date.now();
  const cached = cache.get(tier);
  if (cached && now - cached.fetchedAt < PACK_WEIGHT_TTL_MS) {
    return { versionId: cached.versionId, weights: cached.weights };
  }

  const row = await prisma.packWeightVersion.findFirst({
    where: { tier, isActive: true },
    orderBy: { createdAt: "desc" },
    select: { id: true, weightsJson: true },
  });

  if (!row) {
    // No solver version yet — fall back to the calibrated `RARITY_WEIGHTS`
    // constant so the app stays bootable on a fresh DB before the first
    // rebalance.
    return { versionId: null, weights: RARITY_WEIGHTS[tier] };
  }

  const weights = coerceWeights(row.weightsJson);
  cache.set(tier, { versionId: row.id, weights, fetchedAt: now });
  return { versionId: row.id, weights };
}

export async function getPinnedWeights(versionId: string): Promise<WeightVector> {
  const row = await prisma.packWeightVersion.findUnique({
    where: { id: versionId },
    select: { weightsJson: true },
  });
  if (!row) {
    const msg = `pack weight version ${versionId} not found`;
    throw new Error(msg);
  }
  return coerceWeights(row.weightsJson);
}

export function invalidateActiveWeights(tier?: TierName): void {
  if (tier) cache.delete(tier);
  else cache.clear();
}

function coerceWeights(raw: unknown): WeightVector {
  if (!raw || typeof raw !== "object") {
    throw new Error("weightsJson is not an object");
  }
  const r = raw as Record<string, unknown>;
  const buckets: Rarity[] = ["COMMON", "UNCOMMON", "RARE", "EPIC", "LEGENDARY"];
  const out: Partial<WeightVector> = {};
  for (const b of buckets) {
    const v = r[b];
    if (typeof v !== "number" || !Number.isFinite(v)) {
      throw new Error(`weightsJson.${b} is not a finite number`);
    }
    out[b] = v;
  }
  return out as WeightVector;
}
