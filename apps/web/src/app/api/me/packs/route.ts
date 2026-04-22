import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

type RevealedFilter = "false" | "true" | "all";

function parseRevealed(raw: string | null): RevealedFilter | null {
  if (raw === null) return "false"; // Phase 1 default: unopened only.
  if (raw === "false" || raw === "true" || raw === "all") return raw;
  return null; // invalid value
}

export async function GET(request: NextRequest) {
  const session = await getCurrentUser();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const revealed = parseRevealed(request.nextUrl.searchParams.get("revealed"));
  if (revealed === null) {
    return NextResponse.json({ error: "invalid_revealed" }, { status: 400 });
  }

  const where =
    revealed === "all"
      ? { userId: session.userId }
      : { userId: session.userId, isRevealed: revealed === "true" };

  const packs = await prisma.userPack.findMany({
    where,
    orderBy: { purchasedAt: "desc" },
    select: {
      id: true,
      dropId: true,
      purchasedAt: true,
      isRevealed: true,
      drop: { select: { packTier: true } },
    },
  });

  return NextResponse.json({
    packs: packs.map((p) => ({
      id: p.id,
      dropId: p.dropId,
      purchasedAt: p.purchasedAt.toISOString(),
      isRevealed: p.isRevealed,
      packTier: p.drop.packTier,
    })),
  });
}
