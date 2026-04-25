import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { computeEconomics, snapshotToCsv, type WindowKey, type EconomicsSnapshot } from "@/lib/economics";

const VALID_WINDOWS: ReadonlySet<WindowKey> = new Set(["today", "7d", "30d", "all"]);
const CACHE_TTL_MS = 5 * 60 * 1000;

// Process-local cache. Keyed by window. Survives until TTL or `?fresh=1`.
// Multi-instance prod would need Redis; single-process is fine here.
const cache = new Map<WindowKey, { at: number; data: EconomicsSnapshot }>();

// GET /api/admin/economics?window=today|7d|30d|all&format=json|csv&fresh=1
export async function GET(request: Request) {
  const session = await getCurrentUser();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const me = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { isAdmin: true },
  });
  if (!me?.isAdmin) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const url = new URL(request.url);
  const windowRaw = url.searchParams.get("window");
  const window: WindowKey = windowRaw && VALID_WINDOWS.has(windowRaw as WindowKey)
    ? (windowRaw as WindowKey) : "all";
  const format = url.searchParams.get("format") === "csv" ? "csv" : "json";
  const fresh = url.searchParams.get("fresh") === "1";

  const now = Date.now();
  let snapshot: EconomicsSnapshot;
  const cached = cache.get(window);
  if (!fresh && cached && now - cached.at < CACHE_TTL_MS) {
    snapshot = cached.data;
  } else {
    snapshot = await computeEconomics(window);
    cache.set(window, { at: now, data: snapshot });
  }

  if (format === "csv") {
    const csv = snapshotToCsv(snapshot);
    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="pullvault-economics-${window}-${snapshot.generatedAt.slice(0, 10)}.csv"`,
      },
    });
  }

  return NextResponse.json(snapshot);
}
