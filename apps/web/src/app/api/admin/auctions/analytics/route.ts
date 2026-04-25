import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

const SNIPE_WINDOW_SEC = 30;

// GET /api/admin/auctions/analytics?window=7d|30d|all
//
// Returns participation, final-vs-market ratio distribution, snipe rate
// (% of bids placed in last 30s before close), and flag-rate counts.
export async function GET(request: Request) {
  const session = await getCurrentUser();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const me = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { isAdmin: true },
  });
  if (!me?.isAdmin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const url = new URL(request.url);
  const windowKey = url.searchParams.get("window") ?? "7d";
  const since = sinceFor(windowKey);

  const [closedRows, snipeRows, flagRows, ratioRows] = await Promise.all([
    prisma.$queryRaw<Array<{
      total: bigint; with_winner: bigint; cancelled: bigint; closed_no_winner: bigint;
      avg_bidders: number | null; avg_extensions: number | null;
    }>>`
      SELECT COUNT(*)::bigint AS total,
             COUNT(*) FILTER (WHERE status = 'CLOSED' AND winner_id IS NOT NULL)::bigint AS with_winner,
             COUNT(*) FILTER (WHERE status = 'CANCELLED')::bigint AS cancelled,
             COUNT(*) FILTER (WHERE status = 'CLOSED' AND winner_id IS NULL)::bigint AS closed_no_winner,
             AVG((SELECT COUNT(DISTINCT bidder_id) FROM bids b WHERE b.auction_id = a.id))::float AS avg_bidders,
             AVG(extensions)::float AS avg_extensions
      FROM auctions a
      WHERE created_at >= ${since}
    `,
    prisma.$queryRaw<Array<{ total: bigint; sniped: bigint }>>`
      SELECT COUNT(*)::bigint AS total,
             COUNT(*) FILTER (
               WHERE EXTRACT(EPOCH FROM (a.closes_at - b.created_at)) <= ${SNIPE_WINDOW_SEC}
             )::bigint AS sniped
      FROM bids b
      JOIN auctions a ON a.id = b.auction_id
      WHERE b.created_at >= ${since}
    `,
    prisma.$queryRaw<Array<{ reason: string; cnt: bigint }>>`
      SELECT reason, COUNT(*)::bigint AS cnt
      FROM auction_flags
      WHERE created_at >= ${since}
      GROUP BY reason
    `,
    prisma.$queryRaw<Array<{
      bucket: string; cnt: bigint;
    }>>`
      SELECT CASE
               WHEN c.base_price <= 0 THEN 'unknown'
               WHEN a.current_bid / c.base_price < 0.5 THEN 'lt_0_5x'
               WHEN a.current_bid / c.base_price < 1.0 THEN 'lt_1x'
               WHEN a.current_bid / c.base_price < 2.0 THEN 'lt_2x'
               WHEN a.current_bid / c.base_price < 3.0 THEN 'lt_3x'
               ELSE 'gte_3x'
             END AS bucket,
             COUNT(*)::bigint AS cnt
      FROM auctions a
      JOIN user_cards uc ON uc.id = a.user_card_id
      JOIN cards c ON c.id = uc.card_id
      WHERE a.status = 'CLOSED' AND a.winner_id IS NOT NULL
        AND a.closed_at >= ${since}
      GROUP BY bucket
    `,
  ]);

  const closed = closedRows[0]!;
  const snipe = snipeRows[0]!;
  const totalBids = Number(snipe.total ?? BigInt(0));
  const snipedBids = Number(snipe.sniped ?? BigInt(0));

  return NextResponse.json({
    window: windowKey,
    since: since.toISOString(),
    auctions: {
      total: Number(closed.total),
      withWinner: Number(closed.with_winner),
      cancelled: Number(closed.cancelled),
      closedNoWinner: Number(closed.closed_no_winner),
      avgBiddersPerAuction: closed.avg_bidders ?? 0,
      avgExtensions: closed.avg_extensions ?? 0,
    },
    bids: {
      total: totalBids,
      sniped: snipedBids,
      snipeRatePct: totalBids > 0 ? (100 * snipedBids) / totalBids : 0,
    },
    flags: Object.fromEntries(flagRows.map((r) => [r.reason, Number(r.cnt)])),
    finalVsMarket: Object.fromEntries(ratioRows.map((r) => [r.bucket, Number(r.cnt)])),
  });
}

function sinceFor(window: string): Date {
  const days = window === "30d" ? 30 : window === "all" ? 365 * 10 : 7;
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}
