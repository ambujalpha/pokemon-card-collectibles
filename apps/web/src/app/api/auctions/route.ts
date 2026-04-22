import { Prisma, Rarity } from "@prisma/client";
import { NextResponse } from "next/server";

import { resolveDuration } from "@/lib/auction-math";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { parseMoney, MoneyParseError } from "@/lib/money";
import { emitToRoom } from "@/lib/ws-emit";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALID_RARITIES: ReadonlySet<Rarity> = new Set([
  "COMMON", "UNCOMMON", "RARE", "EPIC", "LEGENDARY",
]);

// POST /api/auctions
// Body: { userCardId, startingBid, durationKey: "1h"|"6h"|"24h" }
export async function POST(request: Request) {
  const session = await getCurrentUser();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: { userCardId?: unknown; startingBid?: unknown; durationKey?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const { userCardId, startingBid, durationKey } = body;
  if (typeof userCardId !== "string" || !UUID_RE.test(userCardId)) {
    return NextResponse.json({ error: "invalid_user_card_id" }, { status: 400 });
  }
  const seconds = resolveDuration(durationKey);
  if (seconds === null) {
    return NextResponse.json({ error: "invalid_duration" }, { status: 400 });
  }
  let startDec: Prisma.Decimal;
  try {
    const parsed = parseMoney(startingBid);
    startDec = new Prisma.Decimal(parsed.toFixed(4));
  } catch (err) {
    if (err instanceof MoneyParseError) {
      return NextResponse.json({ error: "invalid_starting_bid", message: err.message }, { status: 400 });
    }
    throw err;
  }

  const auction = await prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<{ id: string; user_id: string; status: string }[]>`
      SELECT id, user_id, status FROM user_cards
      WHERE id = ${userCardId}::uuid FOR UPDATE
    `;
    if (locked.length === 0) return { error: "not_found" as const };
    const uc = locked[0];
    if (uc.user_id !== session.userId) return { error: "not_owner" as const };
    if (uc.status !== "HELD") return { error: "not_auctionable" as const, status: uc.status };

    const now = new Date();
    const closesAt = new Date(now.getTime() + seconds * 1000);
    const created = await tx.auction.create({
      data: {
        sellerId: session.userId,
        userCardId,
        startingBid: startDec,
        startsAt: now,
        closesAt,
      },
    });
    await tx.userCard.update({
      where: { id: userCardId },
      data: { status: "AUCTION" },
    });
    return { ok: true as const, auction: created };
  }, {
    isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
    timeout: 10_000,
  });

  if ("error" in auction) {
    const status = auction.error === "not_found" ? 404
      : auction.error === "not_owner" ? 403 : 409;
    return NextResponse.json(auction, { status });
  }

  await emitToRoom("auctions", "auction_event", {
    auctionId: auction.auction.id,
    event: "created",
  });

  return NextResponse.json({
    id: auction.auction.id,
    userCardId,
    startingBid: startDec.toFixed(4),
    closesAt: auction.auction.closesAt.toISOString(),
    status: auction.auction.status,
  });
}

// GET /api/auctions
// Query: status=live|closed, rarity=..., sort=ending_soon|newest|price_asc|price_desc
type BrowseStatus = "live" | "closed";
type BrowseSort = "ending_soon" | "newest" | "price_asc" | "price_desc";
const VALID_STATUS: ReadonlySet<BrowseStatus> = new Set(["live", "closed"]);
const VALID_SORTS: ReadonlySet<BrowseSort> = new Set(["ending_soon", "newest", "price_asc", "price_desc"]);

export async function GET(request: Request) {
  const session = await getCurrentUser();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const statusRaw = url.searchParams.get("status");
  const status: BrowseStatus = statusRaw && VALID_STATUS.has(statusRaw as BrowseStatus)
    ? (statusRaw as BrowseStatus) : "live";
  const sortRaw = url.searchParams.get("sort");
  const sort: BrowseSort = sortRaw && VALID_SORTS.has(sortRaw as BrowseSort)
    ? (sortRaw as BrowseSort) : "ending_soon";
  const rarities = url.searchParams
    .getAll("rarity")
    .filter((r): r is Rarity => VALID_RARITIES.has(r as Rarity));

  const orderBy: Prisma.AuctionOrderByWithRelationInput =
    sort === "newest" ? { createdAt: "desc" }
    : sort === "price_asc" ? { currentBid: "asc" }
    : sort === "price_desc" ? { currentBid: "desc" }
    : { closesAt: "asc" };

  const auctions = await prisma.auction.findMany({
    where: {
      status: status === "live" ? "LIVE" : "CLOSED",
      ...(rarities.length > 0
        ? { userCard: { card: { rarityBucket: { in: rarities } } } }
        : {}),
    },
    orderBy,
    take: 120,
    select: {
      id: true,
      sellerId: true,
      startingBid: true,
      currentBid: true,
      currentBidderId: true,
      closesAt: true,
      status: true,
      userCard: {
        select: {
          card: {
            select: {
              id: true,
              name: true,
              rarityBucket: true,
              imageUrl: true,
              basePrice: true,
            },
          },
        },
      },
    },
  });

  return NextResponse.json({
    auctions: auctions.map((a) => ({
      id: a.id,
      startingBid: new Prisma.Decimal(a.startingBid).toFixed(4),
      currentBid: a.currentBid ? new Prisma.Decimal(a.currentBid).toFixed(4) : null,
      currentMarketPrice: new Prisma.Decimal(a.userCard.card.basePrice).toFixed(4),
      closesAt: a.closesAt.toISOString(),
      status: a.status,
      isOwn: a.sellerId === session.userId,
      isLeading: a.currentBidderId === session.userId,
      card: {
        id: a.userCard.card.id,
        name: a.userCard.card.name,
        rarity: a.userCard.card.rarityBucket,
        imageUrl: a.userCard.card.imageUrl,
      },
    })),
  });
}
