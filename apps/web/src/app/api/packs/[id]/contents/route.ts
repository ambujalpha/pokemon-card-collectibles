import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

import { serializeReveal } from "../reveal/route";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /api/packs/:id/contents
//
// Revisit-only. Returns the same {pack, cards} shape as POST /reveal, but
// only if the pack has already been revealed. Use case: Opened tab → static
// reveal page. 409 if not yet revealed — forces the user through POST /reveal
// (the animation route) the first time.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getCurrentUser();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id: packId } = await params;
  if (!UUID_RE.test(packId)) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }

  const pack = await prisma.userPack.findUnique({
    where: { id: packId },
    select: {
      id: true,
      userId: true,
      dropId: true,
      purchasedAt: true,
      isRevealed: true,
      drop: { select: { packTier: true } },
    },
  });
  if (!pack) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (pack.userId !== session.userId) {
    return NextResponse.json({ error: "not_owner" }, { status: 403 });
  }
  if (!pack.isRevealed) {
    return NextResponse.json({ error: "not_yet_revealed" }, { status: 409 });
  }

  const packCards = await prisma.packCard.findMany({
    where: { userPackId: pack.id },
    select: {
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

  return NextResponse.json(serializeReveal(pack, packCards));
}
