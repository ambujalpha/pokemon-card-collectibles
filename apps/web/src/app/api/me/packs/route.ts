import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function GET() {
  const session = await getCurrentUser();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const packs = await prisma.userPack.findMany({
    where: { userId: session.userId },
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
