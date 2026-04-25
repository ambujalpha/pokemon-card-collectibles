import { PackTier } from "@prisma/client";
import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { loadBucketMeans } from "@/lib/economics/bucket-means";
import { mulberry32, simulate } from "@/lib/economics/simulate";
import { solveWeights, type WeightVector } from "@/lib/economics/solver";
import { WIN_RATE_FLOORS } from "@/lib/economics/winRate";
import { RARITY_WEIGHTS, TIER_PRICES_USD, type TierName } from "@/lib/rarity-weights";

const TIER_TARGET_MARGIN: Record<TierName, number> = {
  STARTER: 0.35,
  PREMIUM: 0.25,
  ULTRA: 0.15,
};

const MAX_N = 100_000;

// POST /api/admin/economics/simulate?tier=starter|premium|ultra&n=10000
export async function POST(request: Request) {
  const session = await getCurrentUser();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const me = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { isAdmin: true },
  });
  if (!me?.isAdmin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const url = new URL(request.url);
  const tierRaw = (url.searchParams.get("tier") ?? "").toUpperCase();
  const tier = tierRaw as TierName;
  if (!(tier in TIER_TARGET_MARGIN)) {
    return NextResponse.json({ error: "invalid_tier" }, { status: 400 });
  }
  const nRaw = Number(url.searchParams.get("n") ?? "10000");
  const n = Number.isFinite(nRaw) ? Math.min(Math.max(Math.floor(nRaw), 1), MAX_N) : 10_000;
  const seedRaw = Number(url.searchParams.get("seed") ?? "1337");
  const seed = Number.isFinite(seedRaw) ? seedRaw : 1337;

  // Simulate against the currently active version if present, otherwise the
  // static RARITY_WEIGHTS fallback — whichever the purchase route would use.
  const active = await prisma.packWeightVersion.findFirst({
    where: { tier: tier as PackTier, isActive: true },
    orderBy: { createdAt: "desc" },
    select: { id: true, weightsJson: true },
  });

  let weights: WeightVector;
  let weightVersionId: string | null = null;
  if (active) {
    weights = active.weightsJson as unknown as WeightVector;
    weightVersionId = active.id;
  } else {
    weights = RARITY_WEIGHTS[tier];
  }

  const { meansUsd, latestRefreshedAt } = await loadBucketMeans();
  const tierPrice = Number(TIER_PRICES_USD[tier]);

  const res = simulate({
    tier,
    tierPriceUsd: tierPrice,
    weights,
    bucketMeanUsd: meansUsd,
    n,
    rng: mulberry32(seed),
  });

  // Also surface what the solver *would* produce right now — useful to
  // compare current vs. proposed weights.
  const proposed = solveWeights({
    tier,
    tierPriceUsd: tierPrice,
    targetMargin: TIER_TARGET_MARGIN[tier],
    bucketMeanUsd: meansUsd,
    baseShape: RARITY_WEIGHTS[tier],
    constraints: { winRateFloor: WIN_RATE_FLOORS[tier], perBucketMin: {
      COMMON: 0, UNCOMMON: 0, RARE: 0, EPIC: 0, LEGENDARY: 0,
    } },
  });

  return NextResponse.json({
    tier,
    n,
    seed,
    weightVersionId,
    weightsUsed: weights,
    bucketMeansUsd: meansUsd,
    pricesAsOf: latestRefreshedAt.toISOString(),
    targetMargin: TIER_TARGET_MARGIN[tier],
    realisedMargin: res.realisedMargin,
    winRate: res.winRate,
    winRateFloor: WIN_RATE_FLOORS[tier],
    totalRevenueUsd: res.totalRevenueUsd,
    totalPayoutUsd: res.totalPayoutUsd,
    bucketHitRates: res.bucketHitRates,
    proposed: {
      weights: proposed.weights,
      evPerPackUsd: proposed.evPerPackUsd,
      realisedMargin: proposed.realisedMargin,
      constraintBinding: proposed.constraintBinding,
    },
  });
}
