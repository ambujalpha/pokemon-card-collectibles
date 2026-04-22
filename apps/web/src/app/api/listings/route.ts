import { LedgerReason, Prisma, Rarity } from "@prisma/client";
import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { parseMoney, MoneyParseError } from "@/lib/money";
import { emitToRoom } from "@/lib/ws-emit";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALID_RARITIES: ReadonlySet<Rarity> = new Set([
  "COMMON", "UNCOMMON", "RARE", "EPIC", "LEGENDARY",
]);
void LedgerReason; // referenced so this file compiles cleanly if unused

// POST /api/listings — create a listing
// Body: { userCardId: uuid, priceAsk: string|number }
// 400 invalid input, 404 card not found, 403 not owner, 409 already listed,
// 200 with the new listing row.
export async function POST(request: Request) {
  const session = await getCurrentUser();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: { userCardId?: unknown; priceAsk?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const { userCardId, priceAsk } = body;
  if (typeof userCardId !== "string" || !UUID_RE.test(userCardId)) {
    return NextResponse.json({ error: "invalid_user_card_id" }, { status: 400 });
  }
  let priceDec: Prisma.Decimal;
  try {
    const parsed = parseMoney(priceAsk);
    priceDec = new Prisma.Decimal(parsed.toFixed(4));
  } catch (err) {
    if (err instanceof MoneyParseError) {
      return NextResponse.json({ error: "invalid_price", message: err.message }, { status: 400 });
    }
    throw err;
  }

  const userCard = await prisma.userCard.findUnique({
    where: { id: userCardId },
    select: { id: true, userId: true, status: true },
  });
  if (!userCard) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (userCard.userId !== session.userId) {
    return NextResponse.json({ error: "not_owner" }, { status: 403 });
  }
  if (userCard.status !== "HELD") {
    return NextResponse.json({ error: "not_listable", status: userCard.status }, { status: 409 });
  }

  const listing = await prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<{ id: string; status: string }[]>`
      SELECT id, status FROM user_cards WHERE id = ${userCardId}::uuid FOR UPDATE
    `;
    if (locked.length === 0 || locked[0].status !== "HELD") {
      return null;
    }
    const created = await tx.listing.create({
      data: {
        sellerId: session.userId,
        userCardId,
        priceAsk: priceDec,
      },
    });
    await tx.userCard.update({
      where: { id: userCardId },
      data: { status: "LISTED" },
    });
    return created;
  }, {
    isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
    timeout: 10_000,
  });

  if (!listing) {
    return NextResponse.json({ error: "not_listable" }, { status: 409 });
  }

  await emitToRoom("listings", "listing_event", {
    listingId: listing.id,
    event: "created",
  });

  return NextResponse.json({
    id: listing.id,
    userCardId,
    priceAsk: new Prisma.Decimal(listing.priceAsk).toFixed(4),
    status: listing.status,
    createdAt: listing.createdAt.toISOString(),
  });
}

// GET /api/listings — browse ACTIVE listings
// Query:
//   sort   = new (default) | price_asc | price_desc
//   rarity = repeatable
//   mine   = 1 to include own listings (default excludes)
type BrowseSort = "new" | "price_asc" | "price_desc";
const VALID_SORTS: ReadonlySet<BrowseSort> = new Set(["new", "price_asc", "price_desc"]);

export async function GET(request: Request) {
  const session = await getCurrentUser();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const sortRaw = url.searchParams.get("sort");
  const sort: BrowseSort = sortRaw && VALID_SORTS.has(sortRaw as BrowseSort)
    ? (sortRaw as BrowseSort) : "new";
  const rarities = url.searchParams
    .getAll("rarity")
    .filter((r): r is Rarity => VALID_RARITIES.has(r as Rarity));
  const includeMine = url.searchParams.get("mine") === "1";

  const listings = await prisma.listing.findMany({
    where: {
      status: "ACTIVE",
      ...(includeMine ? {} : { sellerId: { not: session.userId } }),
      ...(rarities.length > 0
        ? { userCard: { card: { rarityBucket: { in: rarities } } } }
        : {}),
    },
    orderBy:
      sort === "price_asc" ? { priceAsk: "asc" }
      : sort === "price_desc" ? { priceAsk: "desc" }
      : { createdAt: "desc" },
    select: {
      id: true,
      priceAsk: true,
      createdAt: true,
      sellerId: true,
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
    take: 120,
  });

  return NextResponse.json({
    listings: listings.map((l) => ({
      id: l.id,
      priceAsk: new Prisma.Decimal(l.priceAsk).toFixed(4),
      currentMarketPrice: new Prisma.Decimal(l.userCard.card.basePrice).toFixed(4),
      createdAt: l.createdAt.toISOString(),
      isOwn: l.sellerId === session.userId,
      card: {
        id: l.userCard.card.id,
        name: l.userCard.card.name,
        rarity: l.userCard.card.rarityBucket,
        imageUrl: l.userCard.card.imageUrl,
      },
    })),
  });
}
