import { Prisma, Rarity, UserCardStatus } from "@prisma/client";
import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

// GET /api/collection
//
// Returns the current user's card collection (HELD + LISTED — SOLD cards
// belong to somebody else now). Each row includes the joined card record,
// the listing row if LISTED, and the live aggregate totals computed once
// server-side so the UI doesn't have to re-sum on every WS tick.
//
// Query params (all optional):
//   sort   = value_desc (default) | acquired_desc | pnl_desc
//   rarity = COMMON | UNCOMMON | RARE | EPIC | LEGENDARY (repeatable)

type SortKey = "value_desc" | "acquired_desc" | "pnl_desc";

const VALID_SORTS: ReadonlySet<SortKey> = new Set(["value_desc", "acquired_desc", "pnl_desc"]);
const VALID_RARITIES: ReadonlySet<Rarity> = new Set([
  "COMMON", "UNCOMMON", "RARE", "EPIC", "LEGENDARY",
]);

export async function GET(request: Request) {
  const session = await getCurrentUser();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const sortRaw = url.searchParams.get("sort");
  const sort: SortKey = (sortRaw && VALID_SORTS.has(sortRaw as SortKey))
    ? (sortRaw as SortKey)
    : "value_desc";
  const rarityFilters = url.searchParams
    .getAll("rarity")
    .filter((r): r is Rarity => VALID_RARITIES.has(r as Rarity));

  const userCards = await prisma.userCard.findMany({
    where: {
      userId: session.userId,
      status: { in: [UserCardStatus.HELD, UserCardStatus.LISTED] },
      ...(rarityFilters.length > 0
        ? { card: { rarityBucket: { in: rarityFilters } } }
        : {}),
    },
    select: {
      id: true,
      status: true,
      acquiredAt: true,
      acquiredPrice: true,
      card: {
        select: {
          id: true,
          name: true,
          pokemontcgId: true,
          rarityBucket: true,
          imageUrl: true,
          basePrice: true,
          lastPricedAt: true,
          staleSince: true,
        },
      },
      listings: {
        where: { status: "ACTIVE" },
        select: { id: true, priceAsk: true, createdAt: true },
        take: 1,
      },
    },
  });

  interface Row {
    userCardId: string;
    status: UserCardStatus;
    cardId: string;
    name: string;
    pokemontcgId: string;
    rarity: Rarity;
    imageUrl: string;
    acquiredAt: string;
    acquiredPrice: string;
    currentPrice: string;
    lastPricedAt: string | null;
    staleSince: string | null;
    pnlAbs: string;
    pnlPct: string;
    listing: { id: string; priceAsk: string; createdAt: string } | null;
  }

  const rows: Row[] = userCards.map((uc) => {
    const current = new Prisma.Decimal(uc.card.basePrice);
    const acquired = new Prisma.Decimal(uc.acquiredPrice);
    const pnlAbs = current.sub(acquired);
    const pnlPct = acquired.isZero()
      ? new Prisma.Decimal(0)
      : pnlAbs.div(acquired).mul(100);
    const l = uc.listings[0];
    return {
      userCardId: uc.id,
      status: uc.status,
      cardId: uc.card.id,
      name: uc.card.name,
      pokemontcgId: uc.card.pokemontcgId,
      rarity: uc.card.rarityBucket,
      imageUrl: uc.card.imageUrl,
      acquiredAt: uc.acquiredAt.toISOString(),
      acquiredPrice: acquired.toFixed(4),
      currentPrice: current.toFixed(4),
      lastPricedAt: uc.card.lastPricedAt?.toISOString() ?? null,
      staleSince: uc.card.staleSince?.toISOString() ?? null,
      pnlAbs: pnlAbs.toFixed(4),
      pnlPct: pnlPct.toFixed(2),
      listing: l
        ? { id: l.id, priceAsk: new Prisma.Decimal(l.priceAsk).toFixed(4), createdAt: l.createdAt.toISOString() }
        : null,
    };
  });

  rows.sort((a, b) => {
    if (sort === "value_desc") {
      return Number(b.currentPrice) - Number(a.currentPrice);
    }
    if (sort === "pnl_desc") {
      return Number(b.pnlAbs) - Number(a.pnlAbs);
    }
    return b.acquiredAt.localeCompare(a.acquiredAt);
  });

  const totalSpent = rows
    .reduce((a, r) => a.add(r.acquiredPrice), new Prisma.Decimal(0));
  const totalCurrent = rows
    .reduce((a, r) => a.add(r.currentPrice), new Prisma.Decimal(0));
  const totalPnl = totalCurrent.sub(totalSpent);
  const totalPnlPct = totalSpent.isZero()
    ? "0.00"
    : totalPnl.div(totalSpent).mul(100).toFixed(2);

  return NextResponse.json({
    cards: rows,
    totals: {
      count: rows.length,
      totalSpent: totalSpent.toFixed(4),
      totalCurrent: totalCurrent.toFixed(4),
      totalPnl: totalPnl.toFixed(4),
      totalPnlPct,
    },
  });
}
