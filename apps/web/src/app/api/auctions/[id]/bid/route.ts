import { LedgerReason, Prisma } from "@prisma/client";
import { NextResponse } from "next/server";

import {
  isExcessiveOverbid,
  isInSealedWindow,
  tryClaimBidSlot,
} from "@/lib/auction-integrity";
import { applyAntiSnipe, minNextBid } from "@/lib/auction-math";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { parseMoney, MoneyParseError } from "@/lib/money";
import { emitToRoom } from "@/lib/ws-emit";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// POST /api/auctions/:id/bid
// Body: { amount: string|number }
//
// Atomic tx steps:
//   1. SELECT FOR UPDATE auction. Reject if not LIVE or closesAt passed.
//   2. Reject self-bid (seller_id = bidder).
//   3. Validate amount: if no current bid, must equal startingBid. Else must
//      be ≥ minNextBid(currentBid).
//   4. Lock the bidder row FOR UPDATE; balance ≥ amount.
//   5. Release previous high bidder's hold (if any): balance_held -= prev,
//      balance += prev; ledger BID_RELEASE.
//   6. Hold new bidder's funds: balance -= amount, balance_held += amount;
//      ledger BID_HOLD.
//   7. Write bids row. Update auction.currentBid + currentBidderId.
//   8. Apply anti-snipe: if bid is inside the 30s window and extensions < 20,
//      push closesAt +30s.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getCurrentUser();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "invalid_id" }, { status: 400 });

  let body: { amount?: unknown };
  try { body = (await request.json()) as typeof body; }
  catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }

  let amount: Prisma.Decimal;
  try {
    const parsed = parseMoney(body.amount);
    amount = new Prisma.Decimal(parsed.toFixed(4));
  } catch (err) {
    if (err instanceof MoneyParseError) {
      return NextResponse.json({ error: "invalid_amount", message: err.message }, { status: 400 });
    }
    throw err;
  }

  // 2-second min interval between same-user bids on the same auction.
  // Atomic SET NX EX in Redis — kills micro-increment spam without
  // blocking legit bidders (humans can't reliably re-bid in <2 s anyway).
  const slot = await tryClaimBidSlot(session.userId, id);
  if (!slot) {
    return NextResponse.json({ error: "bid_too_fast" }, { status: 429 });
  }

  const result = await prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<{
      id: string; seller_id: string; status: string;
      starting_bid: string; current_bid: string | null;
      current_bidder_id: string | null;
      closes_at: Date; extensions: number;
    }[]>`
      SELECT id, seller_id, status,
             starting_bid::text AS starting_bid,
             current_bid::text AS current_bid,
             current_bidder_id,
             closes_at, extensions
      FROM auctions WHERE id = ${id}::uuid FOR UPDATE
    `;
    if (locked.length === 0) return { error: "not_found" as const };
    const a = locked[0];
    if (a.status !== "LIVE") return { error: "not_live" as const, status: a.status };
    if (a.seller_id === session.userId) return { error: "self_bid" as const };

    const now = new Date();
    if (now >= a.closes_at) return { error: "already_closed" as const };

    // Validate amount against increment rule.
    if (a.current_bid === null) {
      if (!amount.eq(new Prisma.Decimal(a.starting_bid))) {
        return {
          error: "must_match_starting" as const,
          required: new Prisma.Decimal(a.starting_bid).toFixed(4),
        };
      }
    } else {
      const floor = minNextBid(a.current_bid);
      if (amount.lt(new Prisma.Decimal(floor))) {
        return { error: "bid_too_low" as const, minBid: floor };
      }
      // 5× fat-finger cap. Bids more than 5× current high are almost always
      // typos ($1.50 → $1500); reject and ask the user to confirm in UI.
      if (isExcessiveOverbid(a.current_bid, amount)) {
        return {
          error: "excessive_overbid" as const,
          maxAllowed: new Prisma.Decimal(a.current_bid).mul(5).toFixed(4),
        };
      }
    }

    // Lock bidder balance. If there's a previous high bidder that's NOT the
    // same user, lock them too in id-sorted order.
    const prevBidderId = a.current_bidder_id;
    const prevIsSameUser = prevBidderId === session.userId;
    const idsToLock = prevBidderId && !prevIsSameUser
      ? [session.userId, prevBidderId].sort()
      : [session.userId];

    const rows = await tx.$queryRaw<{ id: string; balance: string; balance_held: string }[]>`
      SELECT id, balance::text AS balance, balance_held::text AS balance_held
      FROM users
      WHERE id = ANY(${idsToLock}::uuid[])
      ORDER BY id FOR UPDATE
    `;
    const bidderRow = rows.find((r) => r.id === session.userId);
    if (!bidderRow) return { error: "not_found" as const };

    const bidderBalance = new Prisma.Decimal(bidderRow.balance);
    const bidderHeld = new Prisma.Decimal(bidderRow.balance_held);

    if (prevIsSameUser && a.current_bid !== null) {
      // Raising own bid: need only the delta on top of existing hold.
      const delta = amount.sub(new Prisma.Decimal(a.current_bid));
      if (bidderBalance.lt(delta)) {
        return { error: "insufficient_funds" as const, required: delta.toFixed(4) };
      }
      const balAfter = bidderBalance.sub(delta);
      const heldAfter = bidderHeld.add(delta);
      await tx.user.update({
        where: { id: session.userId },
        data: { balance: balAfter, balanceHeld: heldAfter },
      });
      await tx.ledger.create({
        data: {
          userId: session.userId,
          delta: delta.neg(),
          reason: LedgerReason.BID_HOLD,
          refType: "auction",
          refId: id,
          balanceAfter: balAfter,
        },
      });
    } else {
      if (bidderBalance.lt(amount)) {
        return { error: "insufficient_funds" as const, required: amount.toFixed(4) };
      }
      // Release prior bidder's hold if present.
      if (prevBidderId && a.current_bid !== null) {
        const prevRow = rows.find((r) => r.id === prevBidderId);
        if (prevRow) {
          const prevAmt = new Prisma.Decimal(a.current_bid);
          const prevBal = new Prisma.Decimal(prevRow.balance);
          const prevHeld = new Prisma.Decimal(prevRow.balance_held);
          const prevBalAfter = prevBal.add(prevAmt);
          const prevHeldAfter = prevHeld.sub(prevAmt);
          await tx.user.update({
            where: { id: prevBidderId },
            data: { balance: prevBalAfter, balanceHeld: prevHeldAfter },
          });
          await tx.ledger.create({
            data: {
              userId: prevBidderId,
              delta: prevAmt,
              reason: LedgerReason.BID_RELEASE,
              refType: "auction",
              refId: id,
              balanceAfter: prevBalAfter,
            },
          });
        }
      }
      // Hold new bidder funds.
      const balAfter = bidderBalance.sub(amount);
      const heldAfter = bidderHeld.add(amount);
      await tx.user.update({
        where: { id: session.userId },
        data: { balance: balAfter, balanceHeld: heldAfter },
      });
      await tx.ledger.create({
        data: {
          userId: session.userId,
          delta: amount.neg(),
          reason: LedgerReason.BID_HOLD,
          refType: "auction",
          refId: id,
          balanceAfter: balAfter,
        },
      });
    }

    // Anti-snipe + update auction.
    const snipe = applyAntiSnipe(now, a.closes_at, a.extensions);
    await tx.auction.update({
      where: { id },
      data: {
        currentBid: amount,
        currentBidderId: session.userId,
        closesAt: snipe.closesAt,
        extensions: snipe.extensions,
      },
    });
    await tx.bid.create({
      data: { auctionId: id, bidderId: session.userId, amount },
    });

    return {
      ok: true as const,
      amount: amount.toFixed(4),
      closesAt: snipe.closesAt.toISOString(),
      newClosesAtDate: snipe.closesAt,
      extended: snipe.extensions > a.extensions,
      extensions: snipe.extensions,
      sealed: isInSealedWindow(now, snipe.closesAt),
    };
  }, {
    isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
    timeout: 15_000,
  });

  if ("error" in result) {
    const status =
      result.error === "not_found" ? 404
      : result.error === "self_bid" ? 400
      : result.error === "excessive_overbid" ? 400
      : result.error === "insufficient_funds" ? 402
      : 409;
    return NextResponse.json(result, { status });
  }

  // In the sealed final-minute window, suppress per-bid broadcasts. Emit a
  // single sealed_phase_started signal on entry so clients can flip the UI
  // into "sealed" mode. The countdown still ticks via the closesAt field.
  if (result.sealed) {
    await emitToRoom(`auction:${id}`, "sealed_phase_started", {
      auctionId: id,
      closesAt: result.closesAt,
    });
  } else {
    await emitToRoom(`auction:${id}`, "bid_placed", {
      auctionId: id,
      amount: result.amount,
      bidderId: session.userId,
      closesAt: result.closesAt,
      extensions: result.extensions,
    });
  }

  return NextResponse.json({
    ok: result.ok,
    amount: result.amount,
    closesAt: result.closesAt,
    extended: result.extended,
    extensions: result.extensions,
    sealed: result.sealed,
  });
}
