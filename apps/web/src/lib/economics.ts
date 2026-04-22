import { LedgerReason, Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { TIER_CALIBRATED_EV_USD, TIER_PRICES_USD, type TierName } from "@/lib/rarity-weights";

// ─── Types ──────────────────────────────────────────────────────────────────

export type WindowKey = "today" | "7d" | "30d" | "all";

export interface EconomicsSnapshot {
  window: WindowKey;
  since: string | null;
  generatedAt: string;
  packs: {
    totalRevenue: string;
    totalEvRealised: string;
    totalMarginAbs: string;
    totalMarginPct: string;
    perTier: Array<{
      tier: TierName;
      count: number;
      revenue: string;
      evRealised: string;
      evTarget: string;
      marginAbs: string;
      marginPct: string;
      evRealisedVsTargetPct: string;
    }>;
  };
  trades: {
    count: number;
    gmv: string;
    feeRevenue: string;
  };
  auctions: {
    count: number;
    gmv: string;
    feeRevenue: string;
    avgExtensions: string;
    totalSettled: number;
    cancelled: number;
    closedNoWinner: number;
  };
  platform: {
    totalRevenue: string;
    totalFeeRevenue: string;
    activeUsers: number;
  };
  topUsers: Array<{ userId: string; email: string; totalSpend: string }>;
}

// ─── Window → timestamp ────────────────────────────────────────────────────

export function windowSince(window: WindowKey, now: Date = new Date()): Date | null {
  if (window === "all") return null;
  const d = new Date(now);
  if (window === "today") {
    d.setUTCHours(0, 0, 0, 0);
    return d;
  }
  const days = window === "7d" ? 7 : 30;
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

// ─── Aggregation ───────────────────────────────────────────────────────────

// Computes the full snapshot. One call = several SQL trips — they're small,
// indexed scans on ledger.(reason, created_at) and user_packs.purchased_at.
// Caller is expected to cache for ~5 minutes (see admin endpoint).
export async function computeEconomics(window: WindowKey): Promise<EconomicsSnapshot> {
  const since = windowSince(window);
  const sinceFilter = since ? { gte: since } : undefined;

  // Pack sales — group by tier via drop.packTier, count + sum pricedCaptured.
  // Using raw so we can sum pack_cards across joined user_packs cleanly.
  const packRowsRaw = await prisma.$queryRaw<Array<{
    tier: TierName;
    count: bigint;
    ev_realised: string;
  }>>`
    SELECT d.pack_tier::text AS tier,
           COUNT(DISTINCT up.id)::bigint AS count,
           COALESCE(SUM(pc.priced_captured), 0)::text AS ev_realised
    FROM user_packs up
    JOIN drops d ON d.id = up.drop_id
    LEFT JOIN pack_cards pc ON pc.user_pack_id = up.id
    ${since ? Prisma.sql`WHERE up.purchased_at >= ${since}` : Prisma.empty}
    GROUP BY d.pack_tier
  `;

  const perTier = (["STARTER", "PREMIUM", "ULTRA"] as TierName[]).map((tier) => {
    const row = packRowsRaw.find((r) => r.tier === tier);
    const count = Number(row?.count ?? BigInt(0));
    const price = new Prisma.Decimal(TIER_PRICES_USD[tier]);
    const revenue = price.mul(count);
    const evRealised = new Prisma.Decimal(row?.ev_realised ?? "0");
    const evTarget = new Prisma.Decimal(TIER_CALIBRATED_EV_USD[tier]).mul(count);
    const marginAbs = revenue.sub(evRealised);
    const marginPct = revenue.isZero() ? new Prisma.Decimal(0) : marginAbs.div(revenue).mul(100);
    const evVsTarget = evTarget.isZero()
      ? new Prisma.Decimal(0)
      : evRealised.div(evTarget).mul(100);
    return {
      tier,
      count,
      revenue: revenue.toFixed(4),
      evRealised: evRealised.toFixed(4),
      evTarget: evTarget.toFixed(4),
      marginAbs: marginAbs.toFixed(4),
      marginPct: marginPct.toFixed(2),
      evRealisedVsTargetPct: evVsTarget.toFixed(2),
    };
  });

  const totalRevenue = perTier.reduce((a, t) => a.add(t.revenue), new Prisma.Decimal(0));
  const totalEvRealised = perTier.reduce((a, t) => a.add(t.evRealised), new Prisma.Decimal(0));
  const totalMarginAbs = totalRevenue.sub(totalEvRealised);
  const totalMarginPct = totalRevenue.isZero()
    ? new Prisma.Decimal(0)
    : totalMarginAbs.div(totalRevenue).mul(100);

  // Trades — sum TRADE_FEE (negative deltas = revenue); count unique listings.
  const tradeFeeAgg = await prisma.ledger.aggregate({
    where: { reason: LedgerReason.TRADE_FEE, ...(sinceFilter ? { createdAt: sinceFilter } : {}) },
    _sum: { delta: true },
    _count: true,
  });
  const tradeBuyAgg = await prisma.ledger.aggregate({
    where: { reason: LedgerReason.TRADE_BUY, ...(sinceFilter ? { createdAt: sinceFilter } : {}) },
    _sum: { delta: true },
    _count: true,
  });
  const tradeFeeRevenue = tradeFeeAgg._sum.delta
    ? new Prisma.Decimal(tradeFeeAgg._sum.delta).neg()
    : new Prisma.Decimal(0);
  const tradeGmv = tradeBuyAgg._sum.delta
    ? new Prisma.Decimal(tradeBuyAgg._sum.delta).neg()
    : new Prisma.Decimal(0);
  const tradeCount = tradeBuyAgg._count;

  // Auctions — sum AUCTION_FEE revenue + AUCTION_WIN GMV; extension avg from
  // closed auctions with a winner.
  const auctionFeeAgg = await prisma.ledger.aggregate({
    where: { reason: LedgerReason.AUCTION_FEE, ...(sinceFilter ? { createdAt: sinceFilter } : {}) },
    _sum: { delta: true },
  });
  const auctionWinAgg = await prisma.ledger.aggregate({
    where: { reason: LedgerReason.AUCTION_WIN, ...(sinceFilter ? { createdAt: sinceFilter } : {}) },
    _sum: { delta: true },
    _count: true,
  });
  const auctionFeeRevenue = auctionFeeAgg._sum.delta
    ? new Prisma.Decimal(auctionFeeAgg._sum.delta).neg()
    : new Prisma.Decimal(0);
  const auctionGmv = auctionWinAgg._sum.delta
    ? new Prisma.Decimal(auctionWinAgg._sum.delta).neg()
    : new Prisma.Decimal(0);

  const [settledCount, cancelledCount, noWinnerCount, extStats] = await Promise.all([
    prisma.auction.count({
      where: {
        status: "CLOSED",
        winnerId: { not: null },
        ...(sinceFilter ? { closedAt: sinceFilter } : {}),
      },
    }),
    prisma.auction.count({
      where: {
        status: "CANCELLED",
        ...(sinceFilter ? { closedAt: sinceFilter } : {}),
      },
    }),
    prisma.auction.count({
      where: {
        status: "CLOSED",
        winnerId: null,
        ...(sinceFilter ? { closedAt: sinceFilter } : {}),
      },
    }),
    prisma.auction.aggregate({
      where: {
        status: "CLOSED",
        winnerId: { not: null },
        ...(sinceFilter ? { closedAt: sinceFilter } : {}),
      },
      _avg: { extensions: true },
    }),
  ]);

  // Top users by total spend (pack purchases + trade buys + auction wins).
  const topSpendRaw = await prisma.$queryRaw<Array<{ user_id: string; email: string; total_spend: string }>>`
    SELECT l.user_id, u.email,
           SUM(-l.delta)::text AS total_spend
    FROM ledger l
    JOIN users u ON u.id = l.user_id
    WHERE l.reason IN ('PACK_PURCHASE', 'TRADE_BUY', 'AUCTION_WIN')
      ${since ? Prisma.sql`AND l.created_at >= ${since}` : Prisma.empty}
    GROUP BY l.user_id, u.email
    ORDER BY SUM(-l.delta) DESC
    LIMIT 5
  `;

  // Active-user count: anyone with a ledger row in the window.
  const activeUsersAgg = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(DISTINCT user_id)::bigint AS count
    FROM ledger
    ${since ? Prisma.sql`WHERE created_at >= ${since}` : Prisma.empty}
  `;
  const activeUsers = Number(activeUsersAgg[0]?.count ?? BigInt(0));

  const totalFeeRevenue = tradeFeeRevenue.add(auctionFeeRevenue);
  const totalPlatformRevenue = totalMarginAbs.add(totalFeeRevenue);

  return {
    window,
    since: since?.toISOString() ?? null,
    generatedAt: new Date().toISOString(),
    packs: {
      totalRevenue: totalRevenue.toFixed(4),
      totalEvRealised: totalEvRealised.toFixed(4),
      totalMarginAbs: totalMarginAbs.toFixed(4),
      totalMarginPct: totalMarginPct.toFixed(2),
      perTier,
    },
    trades: {
      count: tradeCount,
      gmv: tradeGmv.toFixed(4),
      feeRevenue: tradeFeeRevenue.toFixed(4),
    },
    auctions: {
      count: auctionWinAgg._count,
      gmv: auctionGmv.toFixed(4),
      feeRevenue: auctionFeeRevenue.toFixed(4),
      avgExtensions: (extStats._avg.extensions ?? 0).toFixed(2),
      totalSettled: settledCount,
      cancelled: cancelledCount,
      closedNoWinner: noWinnerCount,
    },
    platform: {
      totalRevenue: totalPlatformRevenue.toFixed(4),
      totalFeeRevenue: totalFeeRevenue.toFixed(4),
      activeUsers,
    },
    topUsers: topSpendRaw.map((r) => ({
      userId: r.user_id,
      email: r.email,
      totalSpend: new Prisma.Decimal(r.total_spend).toFixed(4),
    })),
  };
}

// ─── CSV export ────────────────────────────────────────────────────────────

export function snapshotToCsv(s: EconomicsSnapshot): string {
  const rows: string[][] = [];
  rows.push(["metric", "value"]);
  rows.push(["window", s.window]);
  rows.push(["since", s.since ?? "all time"]);
  rows.push(["generated_at", s.generatedAt]);
  rows.push([]);
  rows.push(["=== Packs ==="]);
  rows.push(["tier", "count", "revenue", "ev_realised", "ev_target", "margin_abs", "margin_pct", "ev_realised_vs_target_pct"]);
  for (const t of s.packs.perTier) {
    rows.push([
      t.tier, String(t.count), t.revenue, t.evRealised, t.evTarget,
      t.marginAbs, t.marginPct, t.evRealisedVsTargetPct,
    ]);
  }
  rows.push(["total_pack_revenue", s.packs.totalRevenue]);
  rows.push(["total_ev_realised", s.packs.totalEvRealised]);
  rows.push(["total_margin_abs", s.packs.totalMarginAbs]);
  rows.push(["total_margin_pct", s.packs.totalMarginPct]);
  rows.push([]);
  rows.push(["=== Trades ==="]);
  rows.push(["count", String(s.trades.count)]);
  rows.push(["gmv", s.trades.gmv]);
  rows.push(["fee_revenue", s.trades.feeRevenue]);
  rows.push([]);
  rows.push(["=== Auctions ==="]);
  rows.push(["settled_with_winner", String(s.auctions.totalSettled)]);
  rows.push(["closed_no_winner", String(s.auctions.closedNoWinner)]);
  rows.push(["cancelled", String(s.auctions.cancelled)]);
  rows.push(["gmv", s.auctions.gmv]);
  rows.push(["fee_revenue", s.auctions.feeRevenue]);
  rows.push(["avg_extensions", s.auctions.avgExtensions]);
  rows.push([]);
  rows.push(["=== Platform ==="]);
  rows.push(["total_revenue", s.platform.totalRevenue]);
  rows.push(["total_fee_revenue", s.platform.totalFeeRevenue]);
  rows.push(["active_users", String(s.platform.activeUsers)]);
  rows.push([]);
  rows.push(["=== Top users by spend ==="]);
  rows.push(["email", "total_spend"]);
  for (const u of s.topUsers) rows.push([u.email, u.totalSpend]);
  return rows.map((r) => r.map(csvCell).join(",")).join("\n");
}

function csvCell(v: string): string {
  if (/[",\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}
