import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { deriveStatus } from "@/lib/drop-status";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const drop = await prisma.drop.findUnique({
    where: { id },
    select: {
      id: true,
      packTier: true,
      totalInventory: true,
      remaining: true,
      startsAt: true,
      endsAt: true,
    },
  });
  if (!drop) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  return NextResponse.json({
    drop: {
      id: drop.id,
      packTier: drop.packTier,
      totalInventory: drop.totalInventory,
      remaining: drop.remaining,
      startsAt: drop.startsAt.toISOString(),
      endsAt: drop.endsAt.toISOString(),
      status: deriveStatus(drop),
    },
  });
}
