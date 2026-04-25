import { PackTier, Rarity } from "@prisma/client";
import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import type { WeightVector } from "@/lib/active-weights";
import { chiSquaredGof } from "@/lib/chi-squared";

const BUCKETS: Rarity[] = ["COMMON", "UNCOMMON", "RARE", "EPIC", "LEGENDARY"];

interface PerTier {
  tier: PackTier;
  observed: Record<Rarity, number>;
  expected: WeightVector | null;
  chi2: number;
  df: number;
  pValue: number;
  revealedPacks: number;
}

// GET /api/fairness/audit?window=7d|30d|all
//
// Aggregates the rarity distribution of revealed packs over the window and
// runs chi-squared GOF against the *active* `pack_weight_versions` row's
// advertised weights. p-value > 0.05 ⇒ statistically indistinguishable.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const windowKey = url.searchParams.get("window") ?? "30d";
  const since = sinceFor(windowKey);

  const obsRows = await prisma.$queryRaw<Array<{
    pack_tier: PackTier;
    rarity_bucket: Rarity;
    cnt: bigint;
  }>>`
    SELECT d.pack_tier, c.rarity_bucket, COUNT(*)::bigint AS cnt
    FROM user_packs up
    JOIN drops d ON d.id = up.drop_id
    JOIN pack_cards pc ON pc.user_pack_id = up.id
    JOIN cards c ON c.id = pc.card_id
    WHERE up.is_revealed = true AND up.purchased_at >= ${since}
    GROUP BY d.pack_tier, c.rarity_bucket
  `;

  const revealedCounts = await prisma.$queryRaw<Array<{
    pack_tier: PackTier;
    cnt: bigint;
  }>>`
    SELECT d.pack_tier, COUNT(*)::bigint AS cnt
    FROM user_packs up
    JOIN drops d ON d.id = up.drop_id
    WHERE up.is_revealed = true AND up.purchased_at >= ${since}
    GROUP BY d.pack_tier
  `;

  const activeVersions = await prisma.packWeightVersion.findMany({
    where: { isActive: true },
    orderBy: { createdAt: "desc" },
  });
  const expectedByTier = new Map<PackTier, WeightVector>();
  for (const v of activeVersions) {
    expectedByTier.set(v.tier, v.weightsJson as unknown as WeightVector);
  }

  const observedByTier: Map<PackTier, Record<Rarity, number>> = new Map();
  for (const row of obsRows) {
    const m = observedByTier.get(row.pack_tier) ?? emptyCounts();
    m[row.rarity_bucket] = Number(row.cnt);
    observedByTier.set(row.pack_tier, m);
  }

  const perTier: PerTier[] = [];
  for (const tier of ["STARTER", "PREMIUM", "ULTRA"] as PackTier[]) {
    const observed = observedByTier.get(tier) ?? emptyCounts();
    const expected = expectedByTier.get(tier) ?? null;
    const observedVec = BUCKETS.map((b) => observed[b]);
    let chi2 = 0;
    let df = 0;
    let pValue = 1;
    if (expected) {
      const expectedVec = BUCKETS.map((b) => expected[b]);
      const sum = expectedVec.reduce((a, b) => a + b, 0);
      const probs = expectedVec.map((v) => v / sum);
      const r = chiSquaredGof(observedVec, probs);
      chi2 = r.chi2;
      df = r.df;
      pValue = r.pValue;
    }
    perTier.push({
      tier,
      observed,
      expected,
      chi2,
      df,
      pValue,
      revealedPacks: Number(revealedCounts.find((r) => r.pack_tier === tier)?.cnt ?? BigInt(0)),
    });
  }

  return NextResponse.json({
    window: windowKey,
    since: since.toISOString(),
    perTier,
  });
}

function emptyCounts(): Record<Rarity, number> {
  return { COMMON: 0, UNCOMMON: 0, RARE: 0, EPIC: 0, LEGENDARY: 0 };
}

function sinceFor(window: string): Date {
  const days = window === "7d" ? 7 : window === "all" ? 365 * 10 : 30;
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}
