import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  refreshAllCards,
  UpstreamError,
  type RefreshResult,
} from "@/lib/pricing";
import { emitToRoom } from "@/lib/ws-emit";

// In-memory coordination. Safe for our single-instance web deployment.
// Multi-instance would need a Redis SETNX lock — known limitation,
// flagged for production hardening.
let runningRefresh: Promise<RefreshResult> | null = null;
let lastRefreshAt = 0;
const MIN_INTERVAL_MS = 5_000;

function parseJitter(raw: unknown): number {
  if (raw === undefined || raw === null) return 0;
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return 0;
  // Hard cap at 20% so demo seam can't be weaponised into showing wild numbers.
  return Math.max(0, Math.min(0.2, n));
}

// POST /api/admin/prices/refresh
//
// Admin-gated. Calls refreshAllCards() (which fetches pokemontcg.io, updates
// Card.basePrice + lastPricedAt, writes PriceSnapshot rows, invalidates Redis)
// and then broadcasts `prices_refreshed` on the WS `prices` room so open
// clients can re-fetch and animate the changes.
//
// Concurrency: in-memory mutex + 5s soft rate limit. Second call while the
// first runs returns 409 `already_running`; calls within 5s return 429.
export async function POST(request: NextRequest) {
  const session = await getCurrentUser();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { isAdmin: true },
  });
  if (!user?.isAdmin) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  if (runningRefresh) {
    return NextResponse.json({ error: "already_running" }, { status: 409 });
  }
  const now = Date.now();
  if (now - lastRefreshAt < MIN_INTERVAL_MS) {
    const waitMs = MIN_INTERVAL_MS - (now - lastRefreshAt);
    return NextResponse.json(
      { error: "too_soon", retryAfterMs: waitMs },
      { status: 429, headers: { "Retry-After": String(Math.ceil(waitMs / 1000)) } },
    );
  }

  let jitter = 0;
  try {
    const contentType = request.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const body = (await request.json()) as { jitter?: unknown };
      jitter = parseJitter(body?.jitter);
    }
  } catch {
    // Empty body or non-JSON is fine — default jitter = 0.
  }

  const work = (async () => {
    try {
      return await refreshAllCards({ jitter });
    } finally {
      lastRefreshAt = Date.now();
    }
  })();
  runningRefresh = work;

  let result: RefreshResult;
  try {
    result = await work;
  } catch (err) {
    runningRefresh = null;
    if (err instanceof UpstreamError) {
      return NextResponse.json({ error: "upstream_error", message: err.message }, { status: 502 });
    }
    console.error("admin prices refresh failed:", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
  runningRefresh = null;

  // Fire-and-forget WS broadcast. Bounded timeout inside emitToRoom.
  await emitToRoom("prices", "prices_refreshed", {
    refreshedAt: result.refreshedAt,
    changes: result.changes,
  });

  return NextResponse.json(result, { status: result.upstreamOk ? 200 : 207 });
}
