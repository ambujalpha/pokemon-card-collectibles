import { LedgerReason, Prisma } from "@prisma/client";
import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { computeTradeFee } from "@/lib/marketplace-fee";
import { emitToRoom } from "@/lib/ws-emit";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// POST /api/listings/:id/purchase — atomic trade.
//
// Tx steps:
//   1. SELECT ... FOR UPDATE on listing; reject if not ACTIVE.
//   2. Lock buyer row; reject if self-purchase or balance < priceAsk.
//   3. Compute fee = ceil5%priceAsk; seller net = priceAsk - fee.
//   4. Listing → SOLD, soldAt, buyerId.
//   5. user_cards.userId = buyer, status = HELD, acquiredPrice = priceAsk,
//      acquiredAt = now.
//   6. Three ledger rows: buyer TRADE_BUY -priceAsk, seller TRADE_SELL
//      +sellerNet, seller TRADE_FEE -fee (or platform pseudo-account — see
//      note). We attribute the fee to the seller row so the seller-visible
//      balance math matches "you received sellerNet".
//
// Note on fee ledger: platform has no user row, so TRADE_FEE is written
// against the *seller* with a negative delta after the TRADE_SELL credit.
// Net effect on seller balance = priceAsk - fee = sellerNet. Ledger audit is
// preserved (three discrete entries) and platform revenue is derivable as
// SUM(delta) WHERE reason = 'TRADE_FEE' and delta < 0.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getCurrentUser();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }

  const result = await prisma.$transaction(async (tx) => {
    const listings = await tx.$queryRaw<{
      id: string;
      seller_id: string;
      user_card_id: string;
      price_ask: string;
      status: string;
    }[]>`
      SELECT id, seller_id, user_card_id, price_ask::text AS price_ask, status
      FROM listings WHERE id = ${id}::uuid FOR UPDATE
    `;
    if (listings.length === 0) return { error: "not_found" as const };
    const listing = listings[0];
    if (listing.status !== "ACTIVE") {
      return { error: "not_active" as const, status: listing.status };
    }
    if (listing.seller_id === session.userId) {
      return { error: "self_purchase" as const };
    }

    const priceAsk = new Prisma.Decimal(listing.price_ask);
    const { fee, sellerNet } = computeTradeFee(priceAsk);
    const feeDec = new Prisma.Decimal(fee);
    const sellerNetDec = new Prisma.Decimal(sellerNet);

    // Lock buyer + seller rows in deterministic order (smaller UUID first)
    // to avoid two-way deadlock when concurrent purchases cross-pair.
    const firstId = session.userId < listing.seller_id ? session.userId : listing.seller_id;
    const secondId = session.userId < listing.seller_id ? listing.seller_id : session.userId;
    const balances = await tx.$queryRaw<{ id: string; balance: string }[]>`
      SELECT id, balance::text AS balance FROM users
      WHERE id IN (${firstId}::uuid, ${secondId}::uuid)
      ORDER BY id FOR UPDATE
    `;
    const buyerRow = balances.find((b) => b.id === session.userId);
    const sellerRow = balances.find((b) => b.id === listing.seller_id);
    if (!buyerRow || !sellerRow) return { error: "not_found" as const };

    const buyerBalance = new Prisma.Decimal(buyerRow.balance);
    if (buyerBalance.lt(priceAsk)) {
      return { error: "insufficient_funds" as const };
    }
    const sellerBalance = new Prisma.Decimal(sellerRow.balance);

    const now = new Date();

    await tx.listing.update({
      where: { id: listing.id },
      data: { status: "SOLD", soldAt: now, buyerId: session.userId },
    });
    await tx.userCard.update({
      where: { id: listing.user_card_id },
      data: {
        userId: session.userId,
        status: "HELD",
        acquiredAt: now,
        acquiredPrice: priceAsk,
      },
    });

    const buyerAfter = buyerBalance.sub(priceAsk);
    const sellerAfterCredit = sellerBalance.add(sellerNetDec);
    const sellerAfterFee = sellerAfterCredit.sub(feeDec);

    await tx.user.update({
      where: { id: session.userId },
      data: { balance: buyerAfter },
    });
    await tx.user.update({
      where: { id: listing.seller_id },
      data: { balance: sellerAfterFee },
    });

    await tx.ledger.createMany({
      data: [
        {
          userId: session.userId,
          delta: priceAsk.neg(),
          reason: LedgerReason.TRADE_BUY,
          refType: "listing",
          refId: listing.id,
          balanceAfter: buyerAfter,
        },
        {
          userId: listing.seller_id,
          delta: sellerNetDec,
          reason: LedgerReason.TRADE_SELL,
          refType: "listing",
          refId: listing.id,
          balanceAfter: sellerAfterCredit,
        },
        {
          userId: listing.seller_id,
          delta: feeDec.neg(),
          reason: LedgerReason.TRADE_FEE,
          refType: "listing",
          refId: listing.id,
          balanceAfter: sellerAfterFee,
        },
      ],
    });

    return {
      ok: true as const,
      listingId: listing.id,
      priceAsk: priceAsk.toFixed(4),
      fee,
      sellerNet,
      buyerBalanceAfter: buyerAfter.toFixed(4),
    };
  }, {
    isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
    timeout: 15_000,
  });

  if ("error" in result) {
    const status =
      result.error === "not_found" ? 404
      : result.error === "not_active" ? 409
      : result.error === "self_purchase" ? 400
      : result.error === "insufficient_funds" ? 402 : 500;
    return NextResponse.json(result, { status });
  }

  await emitToRoom("listings", "listing_event", {
    listingId: result.listingId,
    event: "sold",
  });

  return NextResponse.json(result);
}
