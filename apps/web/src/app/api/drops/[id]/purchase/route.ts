import { PackTier, Prisma } from "@prisma/client";
import { NextResponse } from "next/server";

import { getActiveWeights } from "@/lib/active-weights";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { Decimal } from "@/lib/money";
import { pickCardsWithWeights } from "@/lib/pack-picker";
import { TIER_PRICES_USD } from "@/lib/rarity-weights";
import { emitToRoom } from "@/lib/ws-emit";

const MAX_PACKS_PER_USER_PER_DROP = 5;
const CARDS_PER_PACK = 5;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type PurchaseError =
  | "not_found"
  | "not_live"
  | "sold_out"
  | "over_limit"
  | "insufficient_funds"
  | "invalid_id";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getCurrentUser();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id: dropId } = await params;
  if (!UUID_RE.test(dropId)) {
    return NextResponse.json({ error: "invalid_id" satisfies PurchaseError }, { status: 400 });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      // Row-lock the drop row. All timing, inventory, and per-user checks
      // happen inside this lock so concurrent callers serialise.
      const locked = await tx.$queryRaw<
        { id: string; pack_tier: PackTier; remaining: number; starts_at: Date; ends_at: Date }[]
      >`
        SELECT id, pack_tier, remaining, starts_at, ends_at
        FROM drops
        WHERE id = ${dropId}::uuid
        FOR UPDATE
      `;
      if (locked.length === 0) {
        return { error: "not_found" as PurchaseError };
      }
      const drop = locked[0];

      const now = new Date();
      if (now < drop.starts_at || now >= drop.ends_at) {
        return { error: "not_live" as PurchaseError };
      }
      if (drop.remaining <= 0) {
        return { error: "sold_out" as PurchaseError };
      }

      const existingForUser = await tx.userPack.count({
        where: { userId: session.userId, dropId: drop.id },
      });
      if (existingForUser >= MAX_PACKS_PER_USER_PER_DROP) {
        return { error: "over_limit" as PurchaseError };
      }

      const price = new Decimal(TIER_PRICES_USD[drop.pack_tier]);
      const user = await tx.user.findUnique({
        where: { id: session.userId },
        select: { balance: true },
      });
      if (!user) {
        return { error: "not_found" as PurchaseError };
      }
      const currentBalance = new Decimal(user.balance.toString());
      if (currentBalance.lessThan(price)) {
        return { error: "insufficient_funds" as PurchaseError };
      }

      // Read the full card pool for the picker (Phase 1: ~200 cards, in-memory is fine).
      const pool = await tx.card.findMany({
        select: { id: true, rarityBucket: true, basePrice: true },
      });
      // Phase 8: draw against the currently active solver weights and pin the
      // version on the pack so any post-rebalance audit reads the exact
      // distribution this pack was opened against.
      const { versionId, weights } = await getActiveWeights(tierFromPrisma(drop.pack_tier));
      const picks = pickCardsWithWeights(tierFromPrisma(drop.pack_tier), pool, weights);
      if (picks.length !== CARDS_PER_PACK) {
        throw new Error(`pack-picker returned ${picks.length} cards, expected ${CARDS_PER_PACK}`);
      }

      const remainingAfter = drop.remaining - 1;
      await tx.drop.update({
        where: { id: drop.id },
        data: {
          remaining: remainingAfter,
          status: remainingAfter === 0 ? "SOLD_OUT" : undefined,
        },
      });

      const balanceAfter = currentBalance.sub(price);
      await tx.user.update({
        where: { id: session.userId },
        data: { balance: balanceAfter.toFixed(4) },
      });

      const userPack = await tx.userPack.create({
        data: {
          userId: session.userId,
          dropId: drop.id,
          weightVersionId: versionId,
        },
        select: { id: true, purchasedAt: true },
      });

      await tx.packCard.createMany({
        data: picks.map((card, idx) => ({
          userPackId: userPack.id,
          cardId: card.id,
          pricedCaptured: card.basePrice.toString(),
          position: idx + 1,
        })),
      });

      await tx.ledger.create({
        data: {
          userId: session.userId,
          delta: price.neg().toFixed(4),
          reason: "PACK_PURCHASE",
          refType: "UserPack",
          refId: userPack.id,
          balanceAfter: balanceAfter.toFixed(4),
        },
      });

      return {
        ok: true as const,
        userPackId: userPack.id,
        purchasedAt: userPack.purchasedAt,
        balanceAfter: balanceAfter.toFixed(4),
        remainingAfter,
        dropId: drop.id,
      };
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      timeout: 10_000,
    });

    if ("error" in result) {
      const status =
        result.error === "not_found"
          ? 404
          : result.error === "insufficient_funds" || result.error === "over_limit"
            ? 402
            : 409;
      return NextResponse.json({ error: result.error }, { status });
    }

    await emitToRoom(`drop:${result.dropId}`, "inventory_update", {
      dropId: result.dropId,
      remaining: result.remainingAfter,
    });

    return NextResponse.json({
      userPack: {
        id: result.userPackId,
        dropId: result.dropId,
        purchasedAt: result.purchasedAt.toISOString(),
      },
      balance: result.balanceAfter,
    });
  } catch (err) {
    console.error("purchase failed:", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}

function tierFromPrisma(tier: PackTier): "STARTER" | "PREMIUM" | "ULTRA" {
  return tier;
}
