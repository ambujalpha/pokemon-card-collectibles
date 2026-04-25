import { PackTier } from "@prisma/client";
import { NextResponse } from "next/server";

import { requireAdmin } from "@/lib/admin-guard";
import { evalMarginDrift, persistAlert } from "@/lib/alerts";
import { prisma } from "@/lib/db";
import { TIER_PRICES_USD, type TierName } from "@/lib/rarity-weights";

const TIER_TARGET_MARGIN: Record<TierName, number> = {
  STARTER: 0.35,
  PREMIUM: 0.25,
  ULTRA: 0.15,
};

interface PerTierHealth {
  tier: TierName;
  packsCount: number;
  realisedMargin: number;
  targetMargin: number;
  driftPp: number;
  activeVersion: {
    id: string;
    realisedMargin: string;
    constraintBinding: string | null;
    createdAt: string;
    ageMin: number;
  } | null;
  rebalanceSuggested: boolean;
}

const REBALANCE_SUGGEST_PP = 0.03;

// GET /api/admin/economics/health
//
// Per-tier realised margin vs target, active pack_weight_versions row age,
// rebalance-suggested flag (>3pp drift). Side effect: writes alert rows
// to `admin_alerts` when drift crosses thresholds (see `lib/alerts.ts`).
export async function GET() {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.res;

  const tiers: TierName[] = ["STARTER", "PREMIUM", "ULTRA"];

  const realisedRows = await prisma.$queryRaw<Array<{
    tier: PackTier; packs: bigint; ev_realised: string;
  }>>`
    SELECT d.pack_tier AS tier,
           COUNT(DISTINCT up.id)::bigint AS packs,
           COALESCE(SUM(pc.priced_captured), 0)::text AS ev_realised
    FROM user_packs up
    JOIN drops d ON d.id = up.drop_id
    LEFT JOIN pack_cards pc ON pc.user_pack_id = up.id
    WHERE up.purchased_at >= NOW() - INTERVAL '7 days'
    GROUP BY d.pack_tier
  `;

  const activeVersions = await prisma.packWeightVersion.findMany({
    where: { isActive: true },
    orderBy: { createdAt: "desc" },
  });

  const now = Date.now();
  const perTier: PerTierHealth[] = [];

  for (const tier of tiers) {
    const row = realisedRows.find((r) => r.tier === tier);
    const packsCount = Number(row?.packs ?? BigInt(0));
    const evRealised = Number(row?.ev_realised ?? "0");
    const tierPrice = Number(TIER_PRICES_USD[tier]);
    const realisedMargin = packsCount > 0
      ? (tierPrice * packsCount - evRealised) / (tierPrice * packsCount)
      : TIER_TARGET_MARGIN[tier];
    const targetMargin = TIER_TARGET_MARGIN[tier];
    const drift = realisedMargin - targetMargin;

    const active = activeVersions.find((v) => v.tier === tier);
    perTier.push({
      tier,
      packsCount,
      realisedMargin,
      targetMargin,
      driftPp: drift,
      activeVersion: active ? {
        id: active.id,
        realisedMargin: active.realisedMargin.toString(),
        constraintBinding: active.constraintBinding,
        createdAt: active.createdAt.toISOString(),
        ageMin: Math.floor((now - active.createdAt.getTime()) / 60_000),
      } : null,
      rebalanceSuggested: Math.abs(drift) > REBALANCE_SUGGEST_PP,
    });

    // Side effect: write alerts. Idempotent — persistAlert dedupes on
    // unacknowledged matching kind + tier.
    if (packsCount > 50) {
      const alert = evalMarginDrift(tier as PackTier, realisedMargin, targetMargin);
      if (alert) {
        try { await persistAlert(alert); } catch (err) {
          console.warn("alert persist failed:", err instanceof Error ? err.message : err);
        }
      }
    }
  }

  return NextResponse.json({ perTier });
}
