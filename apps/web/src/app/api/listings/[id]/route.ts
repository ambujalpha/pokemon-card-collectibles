import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { emitToRoom } from "@/lib/ws-emit";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /api/listings/:id — single listing detail.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getCurrentUser();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }

  const listing = await prisma.listing.findUnique({
    where: { id },
    select: {
      id: true,
      sellerId: true,
      priceAsk: true,
      status: true,
      createdAt: true,
      soldAt: true,
      cancelledAt: true,
      buyerId: true,
      userCard: {
        select: {
          acquiredPrice: true,
          acquiredAt: true,
          card: {
            select: {
              id: true,
              name: true,
              rarityBucket: true,
              imageUrl: true,
              basePrice: true,
              lastPricedAt: true,
              staleSince: true,
            },
          },
        },
      },
      seller: { select: { email: true } },
    },
  });
  if (!listing) return NextResponse.json({ error: "not_found" }, { status: 404 });

  return NextResponse.json({
    id: listing.id,
    status: listing.status,
    priceAsk: new Prisma.Decimal(listing.priceAsk).toFixed(4),
    currentMarketPrice: new Prisma.Decimal(listing.userCard.card.basePrice).toFixed(4),
    createdAt: listing.createdAt.toISOString(),
    soldAt: listing.soldAt?.toISOString() ?? null,
    cancelledAt: listing.cancelledAt?.toISOString() ?? null,
    isOwn: listing.sellerId === session.userId,
    sellerEmail: listing.seller.email,
    card: {
      id: listing.userCard.card.id,
      name: listing.userCard.card.name,
      rarity: listing.userCard.card.rarityBucket,
      imageUrl: listing.userCard.card.imageUrl,
      lastPricedAt: listing.userCard.card.lastPricedAt?.toISOString() ?? null,
      staleSince: listing.userCard.card.staleSince?.toISOString() ?? null,
    },
  });
}

// DELETE /api/listings/:id — seller cancel. Only ACTIVE → CANCELLED; card
// flips back to HELD.
export async function DELETE(
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
    const rows = await tx.$queryRaw<{
      id: string; seller_id: string; user_card_id: string; status: string;
    }[]>`
      SELECT id, seller_id, user_card_id, status
      FROM listings WHERE id = ${id}::uuid FOR UPDATE
    `;
    if (rows.length === 0) return { error: "not_found" as const };
    const r = rows[0];
    if (r.seller_id !== session.userId) return { error: "not_owner" as const };
    if (r.status !== "ACTIVE") return { error: "not_cancellable" as const, status: r.status };

    await tx.listing.update({
      where: { id },
      data: { status: "CANCELLED", cancelledAt: new Date() },
    });
    await tx.userCard.update({
      where: { id: r.user_card_id },
      data: { status: "HELD" },
    });
    return { ok: true as const };
  }, {
    isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
    timeout: 10_000,
  });

  if ("error" in result) {
    const status = result.error === "not_found" ? 404
      : result.error === "not_owner" ? 403 : 409;
    return NextResponse.json({ error: result.error }, { status });
  }

  await emitToRoom("listings", "listing_event", {
    listingId: id,
    event: "cancelled",
  });

  return NextResponse.json({ ok: true });
}
