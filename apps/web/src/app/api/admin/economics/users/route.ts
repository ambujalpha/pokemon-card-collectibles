import { NextResponse } from "next/server";

import { requireAdmin } from "@/lib/admin-guard";
import { prisma } from "@/lib/db";

// GET /api/admin/economics/users
//
// Powers the `Users` tab. Active-user count, auction participation %,
// drop engagement %, 7d retention.
export async function GET() {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.res;

  const [totals, auctionParticipation, dropEngagement, retention] = await Promise.all([
    prisma.$queryRaw<Array<{
      total: bigint; active_24h: bigint; active_7d: bigint;
    }>>`
      SELECT COUNT(*)::bigint AS total,
             COUNT(*) FILTER (WHERE id IN (
               SELECT DISTINCT user_id FROM ledger WHERE created_at >= NOW() - INTERVAL '24 hours'
             ))::bigint AS active_24h,
             COUNT(*) FILTER (WHERE id IN (
               SELECT DISTINCT user_id FROM ledger WHERE created_at >= NOW() - INTERVAL '7 days'
             ))::bigint AS active_7d
      FROM users
    `,
    prisma.$queryRaw<Array<{
      bidders: bigint; sellers: bigint;
    }>>`
      SELECT COUNT(DISTINCT bidder_id)::bigint AS bidders,
             (SELECT COUNT(DISTINCT seller_id)::bigint FROM auctions WHERE created_at >= NOW() - INTERVAL '7 days') AS sellers
      FROM bids WHERE created_at >= NOW() - INTERVAL '7 days'
    `,
    prisma.$queryRaw<Array<{
      buyers: bigint;
    }>>`
      SELECT COUNT(DISTINCT user_id)::bigint AS buyers
      FROM user_packs WHERE purchased_at >= NOW() - INTERVAL '7 days'
    `,
    prisma.$queryRaw<Array<{
      cohort: bigint; retained: bigint;
    }>>`
      WITH cohort AS (
        SELECT DISTINCT user_id FROM ledger
        WHERE created_at >= NOW() - INTERVAL '14 days'
          AND created_at < NOW() - INTERVAL '7 days'
      )
      SELECT COUNT(*)::bigint AS cohort,
             COUNT(*) FILTER (WHERE user_id IN (
               SELECT DISTINCT user_id FROM ledger WHERE created_at >= NOW() - INTERVAL '7 days'
             ))::bigint AS retained
      FROM cohort
    `,
  ]);

  const t = totals[0]!;
  const a = auctionParticipation[0]!;
  const d = dropEngagement[0]!;
  const r = retention[0]!;
  const cohort = Number(r.cohort);

  return NextResponse.json({
    totals: {
      total: Number(t.total),
      active24h: Number(t.active_24h),
      active7d: Number(t.active_7d),
    },
    auctionParticipation7d: {
      uniqueBidders: Number(a.bidders),
      uniqueSellers: Number(a.sellers),
    },
    dropEngagement7d: {
      uniqueBuyers: Number(d.buyers),
      pctOfActive: Number(t.active_7d) > 0
        ? (100 * Number(d.buyers)) / Number(t.active_7d)
        : 0,
    },
    retention7d: {
      cohort: cohort,
      retained: Number(r.retained),
      pct: cohort > 0 ? (100 * Number(r.retained)) / cohort : 0,
    },
  });
}
