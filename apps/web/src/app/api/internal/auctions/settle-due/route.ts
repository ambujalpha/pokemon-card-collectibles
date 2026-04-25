import { LedgerReason, Prisma } from "@prisma/client";
import { NextResponse } from "next/server";

import { computeAuctionFee } from "@/lib/auction-math";
import { prisma } from "@/lib/db";
import { evaluateWashTradeSignals } from "@/lib/wash-trade-detect";
import { emitToRoom } from "@/lib/ws-emit";

// POST /api/internal/auctions/settle-due
//
// Called by the close worker in apps/ws every ~1s. Auth via X-Internal-Secret
// header against WS_INTERNAL_SECRET. The web process owns all DB mutations —
// the worker is just a dumb ticker, keeping Prisma + migrations in one place.
//
// Behaviour: find LIVE auctions whose closes_at has passed, settle each one
// in its own tx. Uses SELECT FOR UPDATE SKIP LOCKED so overlapping ticks on
// multiple nodes (or a slow prior tick) don't fight over the same row.
//
// Settlement rules per auction:
//   - No bidder → status CLOSED, no winner, card back to seller HELD.
//   - Winner present → status CLOSED, winner set, fee computed. Winner's
//     balance_held debited by currentBid (AUCTION_WIN). Seller gets
//     AUCTION_SELL +sellerNet, AUCTION_FEE -fee. user_cards.userId flips to
//     winner with status HELD and acquiredPrice = currentBid.
export async function POST(request: Request) {
  const secret = request.headers.get("x-internal-secret");
  const expected = process.env.WS_INTERNAL_SECRET;
  if (!expected || !secret || secret !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const settled: Array<{
    id: string;
    status: "CLOSED";
    winnerId: string | null;
    finalBid: string | null;
    sellerId: string | null;
    marketPriceUsd: string | null;
  }> = [];

  // Loop: pick up to 20 due rows per call. If there are more, the next tick
  // handles them. Limits any single request's fan-out.
  for (let i = 0; i < 20; i++) {
    const settledOne = await settleNextDue();
    if (!settledOne) break;
    settled.push(settledOne);
  }

  // Broadcast outside the DB tx so failures on the WS hop don't undo DB work.
  for (const s of settled) {
    await emitToRoom(`auction:${s.id}`, "auction_closed", {
      auctionId: s.id,
      winnerId: s.winnerId,
      finalBid: s.finalBid,
    });
    await emitToRoom("auctions", "auction_event", {
      auctionId: s.id,
      event: "closed",
    });

    // Phase 10: post-close wash-trade evaluation. Flags go into a review
    // queue (auction_flags); never auto-action.
    if (s.winnerId && s.sellerId && s.finalBid && s.marketPriceUsd) {
      try {
        await evaluateWashTradeSignals({
          auctionId: s.id,
          sellerId: s.sellerId,
          winnerId: s.winnerId,
          finalBid: Number(s.finalBid),
          marketPriceUsd: Number(s.marketPriceUsd),
        });
      } catch (err) {
        // Detector failures must not block settlement broadcast.
        console.warn("wash-trade detect failed:", err instanceof Error ? err.message : err);
      }
    }
  }

  return NextResponse.json({ settled: settled.length, ids: settled.map((s) => s.id) });
}

async function settleNextDue(): Promise<{
  id: string;
  status: "CLOSED";
  winnerId: string | null;
  finalBid: string | null;
  sellerId: string | null;
  marketPriceUsd: string | null;
} | null> {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{
      id: string; seller_id: string; user_card_id: string;
      current_bid: string | null; current_bidder_id: string | null;
      market_price: string | null;
    }[]>`
      SELECT a.id, a.seller_id, a.user_card_id,
             a.current_bid::text AS current_bid, a.current_bidder_id,
             c.base_price::text AS market_price
      FROM auctions a
      JOIN user_cards uc ON uc.id = a.user_card_id
      JOIN cards c ON c.id = uc.card_id
      WHERE a.status = 'LIVE' AND a.closes_at <= now()
      ORDER BY a.closes_at ASC
      LIMIT 1
      FOR UPDATE OF a SKIP LOCKED
    `;
    if (rows.length === 0) return null;
    const a = rows[0];
    const now = new Date();

    if (!a.current_bidder_id || !a.current_bid) {
      // No bids — return card to seller, close auction.
      await tx.auction.update({
        where: { id: a.id },
        data: { status: "CLOSED", closedAt: now },
      });
      await tx.userCard.update({
        where: { id: a.user_card_id },
        data: { status: "HELD" },
      });
      return {
        id: a.id, status: "CLOSED" as const,
        winnerId: null, finalBid: null,
        sellerId: a.seller_id, marketPriceUsd: a.market_price,
      };
    }

    const finalBid = new Prisma.Decimal(a.current_bid);
    const { fee, sellerNet } = computeAuctionFee(finalBid);
    const feeDec = new Prisma.Decimal(fee);
    const sellerNetDec = new Prisma.Decimal(sellerNet);

    // Lock winner + seller rows in id-sorted order.
    const firstId = a.seller_id < a.current_bidder_id ? a.seller_id : a.current_bidder_id;
    const secondId = a.seller_id < a.current_bidder_id ? a.current_bidder_id : a.seller_id;
    const balances = await tx.$queryRaw<{ id: string; balance: string; balance_held: string }[]>`
      SELECT id, balance::text AS balance, balance_held::text AS balance_held
      FROM users WHERE id IN (${firstId}::uuid, ${secondId}::uuid)
      ORDER BY id FOR UPDATE
    `;
    const seller = balances.find((b) => b.id === a.seller_id)!;
    const winner = balances.find((b) => b.id === a.current_bidder_id)!;

    // Debit winner's held balance.
    const winnerHeldAfter = new Prisma.Decimal(winner.balance_held).sub(finalBid);
    await tx.user.update({
      where: { id: a.current_bidder_id },
      data: { balanceHeld: winnerHeldAfter },
    });
    await tx.ledger.create({
      data: {
        userId: a.current_bidder_id,
        delta: finalBid.neg(),
        reason: LedgerReason.AUCTION_WIN,
        refType: "auction",
        refId: a.id,
        // balanceAfter tracks spendable balance, not held. Winner's spendable
        // didn't change here — the hold was already debited at bid time.
        balanceAfter: new Prisma.Decimal(winner.balance),
      },
    });

    // Credit seller net + fee rows.
    const sellerBal = new Prisma.Decimal(seller.balance);
    const sellerAfterCredit = sellerBal.add(sellerNetDec);
    const sellerAfterFee = sellerAfterCredit.sub(feeDec);
    await tx.user.update({
      where: { id: a.seller_id },
      data: { balance: sellerAfterFee },
    });
    await tx.ledger.createMany({
      data: [
        {
          userId: a.seller_id,
          delta: sellerNetDec,
          reason: LedgerReason.AUCTION_SELL,
          refType: "auction",
          refId: a.id,
          balanceAfter: sellerAfterCredit,
        },
        {
          userId: a.seller_id,
          delta: feeDec.neg(),
          reason: LedgerReason.AUCTION_FEE,
          refType: "auction",
          refId: a.id,
          balanceAfter: sellerAfterFee,
        },
      ],
    });

    // Transfer card + close auction.
    await tx.userCard.update({
      where: { id: a.user_card_id },
      data: {
        userId: a.current_bidder_id,
        status: "HELD",
        acquiredAt: now,
        acquiredPrice: finalBid,
      },
    });
    await tx.auction.update({
      where: { id: a.id },
      data: {
        status: "CLOSED",
        closedAt: now,
        winnerId: a.current_bidder_id,
      },
    });

    return {
      id: a.id,
      status: "CLOSED" as const,
      winnerId: a.current_bidder_id,
      finalBid: finalBid.toFixed(4),
      sellerId: a.seller_id,
      marketPriceUsd: a.market_price,
    };
  }, {
    isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
    timeout: 15_000,
  });
}
