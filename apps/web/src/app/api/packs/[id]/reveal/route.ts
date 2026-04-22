import { Prisma, Rarity } from "@prisma/client";
import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { TIER_PRICES_USD, type TierName } from "@/lib/rarity-weights";
import { sortPackCards } from "@/lib/reveal-order";
import { allocateSpend } from "@/lib/spend-allocation";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type RevealError = "not_found" | "not_owner" | "already_revealed" | "invalid_id";

// POST /api/packs/:id/reveal
//
// The single mutation that opens a pack. In one transaction:
//   1. SELECT ... FOR UPDATE on the user_packs row
//   2. ownership check + is_revealed guard
//   3. flip is_revealed=true
//   4. read pack_cards JOIN cards, sorted (rarity ASC, position ASC)
// Two concurrent calls for the same pack: second blocks, then 409s.
// On success returns `{pack, cards}`; the UI plays the animation from here.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getCurrentUser();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id: packId } = await params;
  if (!UUID_RE.test(packId)) {
    return NextResponse.json({ error: "invalid_id" satisfies RevealError }, { status: 400 });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<
        { id: string; user_id: string; is_revealed: boolean }[]
      >`
        SELECT id, user_id, is_revealed
        FROM user_packs
        WHERE id = ${packId}::uuid
        FOR UPDATE
      `;
      if (locked.length === 0) {
        return { error: "not_found" as RevealError };
      }
      const row = locked[0];
      if (row.user_id !== session.userId) {
        return { error: "not_owner" as RevealError };
      }
      if (row.is_revealed) {
        return { error: "already_revealed" as RevealError };
      }

      await tx.userPack.update({
        where: { id: row.id },
        data: { isRevealed: true },
      });

      const packCards = await tx.packCard.findMany({
        where: { userPackId: row.id },
        orderBy: { position: "asc" },
        select: {
          id: true,
          position: true,
          pricedCaptured: true,
          card: {
            select: {
              id: true,
              pokemontcgId: true,
              name: true,
              rarityBucket: true,
              imageUrl: true,
              basePrice: true,
              lastPricedAt: true,
              staleSince: true,
            },
          },
        },
      });

      const pack = await tx.userPack.findUniqueOrThrow({
        where: { id: row.id },
        select: {
          id: true,
          dropId: true,
          purchasedAt: true,
          isRevealed: true,
          drop: { select: { packTier: true } },
        },
      });

      // Phase 4+5: materialise user_cards rows so the collection view + market
      // listings have a stable 1:1 ownership record per pulled card.
      // acquiredPrice is allocated proportionally from pack tier price so the
      // sum matches what the user actually paid.
      const tierPrice = TIER_PRICES_USD[pack.drop.packTier as TierName];
      const allocations = allocateSpend(
        packCards.map((pc) => pc.pricedCaptured),
        tierPrice,
      );
      await tx.userCard.createMany({
        data: packCards.map((pc, i) => ({
          userId: session.userId,
          packCardId: pc.id,
          cardId: pc.card.id,
          acquiredPrice: allocations[i],
        })),
      });

      return { ok: true as const, pack, packCards };
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      timeout: 10_000,
    });

    if ("error" in result) {
      const status =
        result.error === "not_found"
          ? 404
          : result.error === "not_owner"
            ? 403
            : 409;
      return NextResponse.json({ error: result.error }, { status });
    }

    return NextResponse.json(serializeReveal(result.pack, result.packCards));
  } catch (err) {
    console.error("reveal failed:", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}

interface PackRow {
  id: string;
  dropId: string;
  purchasedAt: Date;
  isRevealed: boolean;
  drop: { packTier: string };
}

interface PackCardRow {
  position: number;
  pricedCaptured: Prisma.Decimal;
  card: {
    id: string;
    pokemontcgId: string;
    name: string;
    rarityBucket: Rarity;
    imageUrl: string;
    basePrice: Prisma.Decimal;
    lastPricedAt: Date | null;
    staleSince: Date | null;
  };
}

export function serializeReveal(pack: PackRow, packCards: PackCardRow[]) {
  const sorted = sortPackCards(
    packCards.map((pc) => ({ position: pc.position, rarityBucket: pc.card.rarityBucket, pc })),
  );
  return {
    pack: {
      id: pack.id,
      dropId: pack.dropId,
      packTier: pack.drop.packTier,
      purchasedAt: pack.purchasedAt.toISOString(),
      isRevealed: pack.isRevealed,
    },
    cards: sorted.map((s) => ({
      position: s.pc.position,
      cardId: s.pc.card.id,
      pokemontcgId: s.pc.card.pokemontcgId,
      name: s.pc.card.name,
      rarity: s.pc.card.rarityBucket,
      imageUrl: s.pc.card.imageUrl,
      pricedCaptured: s.pc.pricedCaptured.toFixed(4),
      basePrice: s.pc.card.basePrice.toFixed(4),
      lastPricedAt: s.pc.card.lastPricedAt?.toISOString() ?? null,
      staleSince: s.pc.card.staleSince?.toISOString() ?? null,
    })),
  };
}
