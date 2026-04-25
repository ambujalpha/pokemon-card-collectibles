import { prisma } from "@/lib/db";

// Wash-trade heuristics, run on auction close.
// Writes to `auction_flags` as a review queue; never auto-actions —
// legit collectors do trade with the same partner repeatedly.

export type WashFlagReason =
  | "repeat_pair"
  | "thin_low_clearance"
  | "linked_high_clearance";

const REPEAT_PAIR_WINDOW_DAYS = 7;
const REPEAT_PAIR_THRESHOLD = 3;
const LINKED_HIGH_FACTOR = 3;
const THIN_LOW_FACTOR = 0.5;

export interface WashContext {
  auctionId: string;
  sellerId: string;
  winnerId: string;
  finalBid: number;
  marketPriceUsd: number;
}

export async function evaluateWashTradeSignals(ctx: WashContext): Promise<WashFlagReason[]> {
  const flags: WashFlagReason[] = [];

  // 1. Repeat pair: same seller↔winner in ≥ N closed auctions in last D days.
  const repeatRows = await prisma.$queryRaw<Array<{ cnt: bigint }>>`
    SELECT COUNT(*)::bigint AS cnt
    FROM auctions
    WHERE status = 'CLOSED'
      AND seller_id = ${ctx.sellerId}::uuid
      AND winner_id = ${ctx.winnerId}::uuid
      AND closed_at >= NOW() - (${REPEAT_PAIR_WINDOW_DAYS} || ' days')::INTERVAL
  `;
  if (Number(repeatRows[0]?.cnt ?? BigInt(0)) >= REPEAT_PAIR_THRESHOLD) {
    flags.push("repeat_pair");
  }

  // 2. Suspiciously cheap clearance + thin participation.
  const uniqRows = await prisma.$queryRaw<Array<{ cnt: bigint }>>`
    SELECT COUNT(DISTINCT bidder_id)::bigint AS cnt
    FROM bids WHERE auction_id = ${ctx.auctionId}::uuid
  `;
  const uniqueBidders = Number(uniqRows[0]?.cnt ?? BigInt(0));
  if (
    uniqueBidders < 2 &&
    ctx.marketPriceUsd > 0 &&
    ctx.finalBid < ctx.marketPriceUsd * THIN_LOW_FACTOR
  ) {
    flags.push("thin_low_clearance");
  }

  // 3. Suspiciously high clearance + winner shares an account_link with seller.
  if (ctx.marketPriceUsd > 0 && ctx.finalBid > ctx.marketPriceUsd * LINKED_HIGH_FACTOR) {
    const linkRows = await prisma.$queryRaw<Array<{ cnt: bigint }>>`
      SELECT COUNT(*)::bigint AS cnt
      FROM account_links a
      JOIN account_links b ON a.ip = b.ip AND a.user_agent_hash = b.user_agent_hash
      WHERE a.user_id = ${ctx.sellerId}::uuid
        AND b.user_id = ${ctx.winnerId}::uuid
    `;
    if (Number(linkRows[0]?.cnt ?? BigInt(0)) > 0) {
      flags.push("linked_high_clearance");
    }
  }

  if (flags.length === 0) return [];

  for (const reason of flags) {
    await prisma.$executeRaw`
      INSERT INTO auction_flags (id, auction_id, reason, detail_json)
      VALUES (
        gen_random_uuid(),
        ${ctx.auctionId}::uuid,
        ${reason},
        ${JSON.stringify({
          finalBid: ctx.finalBid,
          marketPriceUsd: ctx.marketPriceUsd,
          sellerId: ctx.sellerId,
          winnerId: ctx.winnerId,
        })}::jsonb
      )
    `;
  }

  return flags;
}
