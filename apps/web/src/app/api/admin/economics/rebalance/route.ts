import { PackTier, Prisma } from "@prisma/client";
import { NextResponse } from "next/server";

import { invalidateActiveWeights } from "@/lib/active-weights";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { loadBucketMeans } from "@/lib/economics/bucket-means";
import { solveWeights, SolverInfeasibleError } from "@/lib/economics/solver";
import { WIN_RATE_FLOORS } from "@/lib/economics/winRate";
import { RARITY_WEIGHTS, TIER_PRICES_USD, type TierName } from "@/lib/rarity-weights";

const TIER_TARGET_MARGIN: Record<TierName, number> = {
  STARTER: 0.35,
  PREMIUM: 0.25,
  ULTRA: 0.15,
};

const TIERS: TierName[] = ["STARTER", "PREMIUM", "ULTRA"];

// POST /api/admin/economics/rebalance  (optional ?tier=…)
//
// Re-solves weights from current market prices, writes one new row per tier
// to pack_weight_versions, and flips `is_active` atomically so the next
// purchase reads the new weights. Already-purchased packs keep their
// pinned `weight_version_id` (see ECONOMICS_SHIFT.md §1.5).
export async function POST(request: Request) {
  const session = await getCurrentUser();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const me = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { isAdmin: true },
  });
  if (!me?.isAdmin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const url = new URL(request.url);
  const tierParam = url.searchParams.get("tier")?.toUpperCase();
  const targetTiers: TierName[] = tierParam && TIERS.includes(tierParam as TierName)
    ? [tierParam as TierName]
    : TIERS;

  const { meansUsd, latestRefreshedAt } = await loadBucketMeans();

  const solved: Array<{
    tier: TierName;
    weights: Record<string, number>;
    evPerPackUsd: number;
    realisedMargin: number;
    constraintBinding: string | null;
  }> = [];
  for (const tier of targetTiers) {
    try {
      const r = solveWeights({
        tier,
        tierPriceUsd: Number(TIER_PRICES_USD[tier]),
        targetMargin: TIER_TARGET_MARGIN[tier],
        bucketMeanUsd: meansUsd,
        baseShape: RARITY_WEIGHTS[tier],
        constraints: { winRateFloor: WIN_RATE_FLOORS[tier], perBucketMin: {
          COMMON: 0, UNCOMMON: 0, RARE: 0, EPIC: 0, LEGENDARY: 0,
        } },
      });
      solved.push({
        tier,
        weights: r.weights,
        evPerPackUsd: r.evPerPackUsd,
        realisedMargin: r.realisedMargin,
        constraintBinding: r.constraintBinding,
      });
    } catch (err) {
      if (err instanceof SolverInfeasibleError) {
        return NextResponse.json(
          { error: "solver_infeasible", tier, diagnostics: err.diagnostics },
          { status: 409 },
        );
      }
      throw err;
    }
  }

  const created = await prisma.$transaction(async (tx) => {
    const rows = [];
    for (const s of solved) {
      // Deactivate current active row(s) for this tier.
      await tx.packWeightVersion.updateMany({
        where: { tier: s.tier as PackTier, isActive: true },
        data: { isActive: false },
      });
      const created = await tx.packWeightVersion.create({
        data: {
          tier: s.tier as PackTier,
          weightsJson: s.weights as unknown as Prisma.InputJsonValue,
          solvedForPricesAt: latestRefreshedAt,
          evPerPackUsd: s.evPerPackUsd.toFixed(4),
          targetMargin: TIER_TARGET_MARGIN[s.tier].toFixed(4),
          realisedMargin: s.realisedMargin.toFixed(4),
          constraintBinding: s.constraintBinding,
          isActive: true,
        },
        select: {
          id: true, tier: true, evPerPackUsd: true, realisedMargin: true,
          constraintBinding: true, createdAt: true,
        },
      });
      rows.push(created);
    }
    return rows;
  });

  invalidateActiveWeights();

  return NextResponse.json({
    pricesAsOf: latestRefreshedAt.toISOString(),
    versions: created.map((v) => ({
      id: v.id,
      tier: v.tier,
      evPerPackUsd: v.evPerPackUsd,
      realisedMargin: v.realisedMargin,
      constraintBinding: v.constraintBinding,
      createdAt: v.createdAt.toISOString(),
    })),
  });
}
