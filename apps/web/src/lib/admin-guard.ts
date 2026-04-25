import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

// Shared admin auth gate for the dashboard section routes. Returns either
// the session user id (allowed) or a NextResponse to short-circuit the
// route with 401 / 403.
export async function requireAdmin(): Promise<
  { ok: true; userId: string } | { ok: false; res: NextResponse }
> {
  const session = await getCurrentUser();
  if (!session) {
    return { ok: false, res: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  }
  const me = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { isAdmin: true },
  });
  if (!me?.isAdmin) {
    return { ok: false, res: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
  }
  return { ok: true, userId: session.userId };
}
