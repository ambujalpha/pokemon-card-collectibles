import { LedgerReason, Prisma } from "@prisma/client";
import { NextResponse } from "next/server";

import { isInSealedWindow } from "@/lib/auction-integrity";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { emitToRoom } from "@/lib/ws-emit";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /api/auctions/:id — detail + full bid history (most recent first).
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getCurrentUser();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "invalid_id" }, { status: 400 });

  const auction = await prisma.auction.findUnique({
    where: { id },
    include: {
      seller: { select: { email: true } },
      winner: { select: { email: true } },
      userCard: {
        select: {
          card: {
            select: {
              id: true, name: true, rarityBucket: true, imageUrl: true,
              basePrice: true, lastPricedAt: true, staleSince: true,
            },
          },
        },
      },
      bids: {
        orderBy: { createdAt: "desc" },
        take: 50,
        include: { bidder: { select: { email: true } } },
      },
    },
  });
  if (!auction) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // Phase 10: redact bid leaderboard during the sealed final-minute window
  // to neutralise reactive sniping. See docs/qa/phase-10-auction-integrity.md.
  const sealed = auction.status === "LIVE" && isInSealedWindow(new Date(), auction.closesAt);

  return NextResponse.json({
    id: auction.id,
    status: auction.status,
    sealed,
    startingBid: new Prisma.Decimal(auction.startingBid).toFixed(4),
    currentBid: sealed
      ? null
      : auction.currentBid ? new Prisma.Decimal(auction.currentBid).toFixed(4) : null,
    currentMarketPrice: new Prisma.Decimal(auction.userCard.card.basePrice).toFixed(4),
    startsAt: auction.startsAt.toISOString(),
    closesAt: auction.closesAt.toISOString(),
    closedAt: auction.closedAt?.toISOString() ?? null,
    extensions: auction.extensions,
    isOwn: auction.sellerId === session.userId,
    isLeading: sealed ? false : auction.currentBidderId === session.userId,
    iWon: auction.winnerId === session.userId,
    sellerEmail: auction.seller.email,
    winnerEmail: auction.winner?.email ?? null,
    card: {
      id: auction.userCard.card.id,
      name: auction.userCard.card.name,
      rarity: auction.userCard.card.rarityBucket,
      imageUrl: auction.userCard.card.imageUrl,
      lastPricedAt: auction.userCard.card.lastPricedAt?.toISOString() ?? null,
      staleSince: auction.userCard.card.staleSince?.toISOString() ?? null,
    },
    bids: sealed ? [] : auction.bids.map((b) => ({
      id: b.id,
      amount: new Prisma.Decimal(b.amount).toFixed(4),
      bidder: b.bidder.email,
      bidderId: b.bidderId,
      createdAt: b.createdAt.toISOString(),
      isOwn: b.bidderId === session.userId,
    })),
  });
}

// DELETE /api/auctions/:id — seller cancel. Only allowed if LIVE and no bids.
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getCurrentUser();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "invalid_id" }, { status: 400 });

  const result = await prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{
      id: string; seller_id: string; user_card_id: string; status: string;
      current_bidder_id: string | null;
    }[]>`
      SELECT id, seller_id, user_card_id, status, current_bidder_id
      FROM auctions WHERE id = ${id}::uuid FOR UPDATE
    `;
    if (rows.length === 0) return { error: "not_found" as const };
    const a = rows[0];
    if (a.seller_id !== session.userId) return { error: "not_owner" as const };
    if (a.status !== "LIVE") return { error: "not_cancellable" as const, status: a.status };
    if (a.current_bidder_id !== null) return { error: "has_bids" as const };

    await tx.auction.update({
      where: { id },
      data: { status: "CANCELLED", closedAt: new Date() },
    });
    await tx.userCard.update({
      where: { id: a.user_card_id },
      data: { status: "HELD" },
    });
    return { ok: true as const };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 10_000 });

  if ("error" in result) {
    const status = result.error === "not_found" ? 404
      : result.error === "not_owner" ? 403 : 409;
    return NextResponse.json(result, { status });
  }

  await emitToRoom(`auction:${id}`, "auction_event", {
    auctionId: id,
    event: "cancelled",
  });
  await emitToRoom("auctions", "auction_event", {
    auctionId: id,
    event: "cancelled",
  });

  return NextResponse.json({ ok: true });
}

void LedgerReason;
