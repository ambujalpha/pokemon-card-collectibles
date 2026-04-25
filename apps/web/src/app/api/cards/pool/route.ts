import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";

// GET /api/cards/pool
//
// Public read of the canonical card pool sorted by id — used by the
// `/verify/pack/:id` browser verifier to reproduce the deterministic
// roll. The pool is intentionally public information; the cryptographic
// guarantees in Phase 11 do not require pool secrecy.
export async function GET() {
  const cards = await prisma.card.findMany({
    select: { id: true, rarityBucket: true },
    orderBy: { id: "asc" },
  });
  return NextResponse.json({ cards });
}
