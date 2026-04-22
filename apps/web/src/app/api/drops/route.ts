import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { deriveStatus } from "@/lib/drop-status";

export async function GET() {
  const drops = await prisma.drop.findMany({
    orderBy: { startsAt: "asc" },
    select: {
      id: true,
      packTier: true,
      totalInventory: true,
      remaining: true,
      startsAt: true,
      endsAt: true,
    },
  });

  return NextResponse.json({
    drops: drops.map((d) => ({
      id: d.id,
      packTier: d.packTier,
      totalInventory: d.totalInventory,
      remaining: d.remaining,
      startsAt: d.startsAt.toISOString(),
      endsAt: d.endsAt.toISOString(),
      status: deriveStatus(d),
    })),
  });
}
