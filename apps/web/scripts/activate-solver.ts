import { PrismaClient } from "@prisma/client";

import { loadBucketMeans } from "@/lib/economics/bucket-means";
import { solveWeights } from "@/lib/economics/solver";
import { WIN_RATE_FLOORS } from "@/lib/economics/winRate";
import { RARITY_WEIGHTS, TIER_PRICES_USD, type TierName } from "@/lib/rarity-weights";

// Solve all three tiers from the latest bucket means and write active rows.
// Equivalent to clicking "Rebalance all tiers" in the admin dashboard, but
// runnable from the CLI for first-time activation or scripted demos.

const TIER_TARGET_MARGIN: Record<TierName, number> = {
  STARTER: 0.35,
  PREMIUM: 0.25,
  ULTRA: 0.15,
};

const ZERO_FLOOR = { COMMON: 0, UNCOMMON: 0, RARE: 0, EPIC: 0, LEGENDARY: 0 };

const prisma = new PrismaClient();

async function main() {
  const { meansUsd, latestRefreshedAt } = await loadBucketMeans();
  console.log("bucket means:", JSON.stringify(meansUsd));

  const tiers: TierName[] = ["STARTER", "PREMIUM", "ULTRA"];

  await prisma.$transaction(async (tx) => {
    for (const tier of tiers) {
      const r = solveWeights({
        tier,
        tierPriceUsd: Number(TIER_PRICES_USD[tier]),
        targetMargin: TIER_TARGET_MARGIN[tier],
        bucketMeanUsd: meansUsd,
        baseShape: RARITY_WEIGHTS[tier],
        constraints: { winRateFloor: WIN_RATE_FLOORS[tier], perBucketMin: ZERO_FLOOR },
      });
      console.log(
        `${tier}: realised=${r.realisedMargin.toFixed(4)} target=${TIER_TARGET_MARGIN[tier]} binding=${r.constraintBinding ?? "—"} ev=$${r.evPerPackUsd.toFixed(2)}`,
      );
      console.log(`  weights: ${JSON.stringify(r.weights)}`);

      await tx.packWeightVersion.updateMany({
        where: { tier, isActive: true },
        data: { isActive: false },
      });
      await tx.packWeightVersion.create({
        data: {
          tier,
          weightsJson: r.weights,
          solvedForPricesAt: latestRefreshedAt,
          evPerPackUsd: r.evPerPackUsd.toFixed(4),
          targetMargin: TIER_TARGET_MARGIN[tier].toFixed(4),
          realisedMargin: r.realisedMargin.toFixed(4),
          constraintBinding: r.constraintBinding,
          isActive: true,
        },
      });
    }
  });

  console.log("\nactive versions written. next purchases will use these weights.");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
